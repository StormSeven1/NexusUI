"""DataLink 探鸟雷达 CSV 上传。

项目默认 e887a1df…；仓库路径：原始数据/{YYYYMMDD}/{filename}.csv
（用 batch-init-upload 自定义路径；专用 bird-radar-csv 接口会写死到 原始数据/探鸟雷达/）
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

DEFAULT_BASE_URL = "http://192.168.18.103:21918"
DEFAULT_PROJECT_ID = "e887a1df-6891-4ac5-af74-b8f271bc1312"
DEFAULT_BRANCH = "main"
DEFAULT_USERNAME = "lp"

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_FILE, override=False)


def _load_config() -> Dict[str, str]:
    return {
        "base_url": (
            os.getenv("BIRD_RADAR_DATALINK_BASE_URL")
            or os.getenv("DATALINK_BASE_URL")
            or os.getenv("EO_CAPTURE_UPLOAD_BASE_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/"),
        "username": (
            os.getenv("BIRD_RADAR_DATALINK_USERNAME")
            or os.getenv("DATALINK_USERNAME")
            or os.getenv("EO_CAPTURE_UPLOAD_USERNAME")
            or DEFAULT_USERNAME
        ),
        "password": (
            os.getenv("BIRD_RADAR_DATALINK_PASSWORD")
            or os.getenv("DATALINK_PASSWORD")
            or os.getenv("EO_CAPTURE_UPLOAD_PASSWORD")
            or ""
        ),
        "project_id": (
            os.getenv("BIRD_RADAR_DATALINK_PROJECT_ID")
            or os.getenv("DATALINK_PROJECT_ID")
            or DEFAULT_PROJECT_ID
        ),
        "branch": os.getenv("BIRD_RADAR_DATALINK_BRANCH") or DEFAULT_BRANCH,
    }


def _safe_csv_name(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", (name or "").strip())[:180]
    base = cleaned or "radar_upload.csv"
    return base if base.lower().endswith(".csv") else f"{base}.csv"


def build_repo_path(file_name: str, now: datetime | None = None) -> str:
    """原始数据/{YYYYMMDD}/{filename}.csv"""
    day = (now or datetime.now()).strftime("%Y%m%d")
    return f"原始数据/{day}/{_safe_csv_name(file_name)}"


async def upload_bird_radar_csv_to_datalink(
    file_bytes: bytes,
    file_name: str,
    *,
    timeout_sec: float = 120.0,
) -> Dict[str, Any]:
    """login → batch-init-upload → PUT → batch-complete-upload → commit。"""
    steps: List[Dict[str, str]] = []
    cfg = _load_config()

    def step(msg: str) -> None:
        steps.append({"status": msg})

    if not file_bytes:
        return {"ok": False, "error": "CSV 文件为空", "steps": steps}
    if not cfg["password"]:
        return {
            "ok": False,
            "error": "未配置 DATALINK 密码（EO_CAPTURE_UPLOAD_PASSWORD 等）",
            "steps": steps,
        }

    upload_name = _safe_csv_name(file_name)
    repo_path = build_repo_path(upload_name)
    base = cfg["base_url"]
    project_id = cfg["project_id"]
    branch = cfg["branch"]

    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        step("登录 DataLink…")
        login = await client.post(
            f"{base}/api/v1/auth/login",
            json={"username": cfg["username"], "password": cfg["password"]},
        )
        if login.status_code != 200:
            return {
                "ok": False,
                "error": f"登录失败 HTTP {login.status_code}",
                "detail": login.text[:200],
                "steps": steps,
            }
        try:
            token = login.json().get("access_token") or ""
        except Exception:
            return {"ok": False, "error": "登录响应解析失败", "steps": steps}
        if not token:
            return {"ok": False, "error": "登录未返回 access_token", "steps": steps}
        step("登录成功")

        headers = {"Authorization": f"Bearer {token}"}

        step(f"初始化上传… → {repo_path}")
        init = await client.post(
            f"{base}/api/v1/projects/{project_id}/files/batch-init-upload",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "files": [
                    {
                        "path": repo_path,
                        "file_size": len(file_bytes),
                        "content_type": "text/csv",
                    }
                ],
                "branch": branch,
            },
        )
        if init.status_code != 200:
            return {
                "ok": False,
                "error": f"初始化失败 HTTP {init.status_code}",
                "detail": init.text[:200],
                "steps": steps,
            }
        try:
            init_data = init.json()
        except Exception:
            return {"ok": False, "error": "初始化响应解析失败", "steps": steps}

        uploads = init_data.get("uploads") or []
        if not uploads:
            return {"ok": False, "error": "初始化响应缺少 uploads", "steps": steps}
        first = uploads[0] if isinstance(uploads[0], dict) else {}
        presigned_url = first.get("presigned_url") or ""
        upload_id = first.get("upload_id") or ""
        branch_name = init_data.get("branch_name") or first.get("branch_name") or branch
        if not presigned_url:
            return {"ok": False, "error": "初始化响应缺少 presigned_url", "steps": steps}
        step("初始化成功")

        step("PUT CSV 内容…")
        put = await client.put(
            presigned_url,
            content=file_bytes,
            headers={
                "Content-Type": "text/csv",
                "Content-Length": str(len(file_bytes)),
            },
        )
        if put.status_code < 200 or put.status_code >= 300:
            return {
                "ok": False,
                "error": f"PUT 失败 HTTP {put.status_code}",
                "steps": steps,
            }
        step("PUT 成功")

        step("通知上传完成…")
        complete = await client.post(
            f"{base}/api/v1/projects/{project_id}/files/batch-complete-upload",
            headers={**headers, "Content-Type": "application/json"},
            json={"file_paths": [repo_path], "branch": branch_name},
        )
        if complete.status_code != 200:
            # 兼容仅提供 complete-upload 的部署
            if upload_id:
                complete = await client.post(
                    f"{base}/api/v1/projects/{project_id}/files/complete-upload",
                    headers={**headers, "Content-Type": "application/json"},
                    json={
                        "upload_id": upload_id,
                        "file_path": repo_path,
                        "branch": branch_name,
                    },
                )
            if complete.status_code != 200:
                return {
                    "ok": False,
                    "error": f"complete-upload 失败 HTTP {complete.status_code}",
                    "detail": complete.text[:200],
                    "steps": steps,
                }
        step("complete-upload 成功")

        commit_message = f"上传探鸟雷达 CSV: {repo_path}"
        step("提交版本…")
        commit = await client.post(
            f"{base}/api/v1/projects/{project_id}/branches/{quote(branch_name, safe='')}/commit",
            params={"message": commit_message},
            headers=headers,
        )
        if commit.status_code < 200 or commit.status_code >= 300:
            return {
                "ok": False,
                "error": f"commit 失败 HTTP {commit.status_code}",
                "detail": commit.text[:200],
                "steps": steps,
            }
        step("上传完成")

    return {
        "ok": True,
        "repo_path": repo_path,
        "filename": upload_name,
        "file_size": len(file_bytes),
        "project_id": project_id,
        "steps": steps,
    }
