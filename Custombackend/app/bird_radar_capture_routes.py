"""探鸟雷达 CSV 采集 API（开始 / 结束 / 状态 / 文件下载 / 上传）。"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from radar_train.csv_recorder import DATA_DIR, capture_manager
from radar_train.datalink_upload import upload_bird_radar_csv_to_datalink

router = APIRouter(prefix="/bird-radar-capture", tags=["bird-radar-capture"])


class CaptureStartBody(BaseModel):
    reason: Optional[str] = Field(None, description="调用来源，如 ui / external")


class CaptureStopBody(BaseModel):
    reason: Optional[str] = Field(None, description="停止原因")


@router.get("/check")
async def capture_check():
    """检查当前是否满足采集条件（对空融合含自报位+探鸟）。"""
    result = capture_manager.check_can_start()
    code = 200 if result.get("ok") else 400
    return JSONResponse(status_code=code, content={"code": code, **result, "timestamp": datetime.now().isoformat()})


@router.post("/start")
async def capture_start(body: CaptureStartBody = CaptureStartBody()):
    reason = (body.reason or "api").strip() or "api"
    result = capture_manager.start_recording(reason=reason)
    code = 200 if result.get("ok") else 400
    return JSONResponse(status_code=code, content={"code": code, **result, "timestamp": datetime.now().isoformat()})


@router.post("/stop")
async def capture_stop(body: CaptureStopBody = CaptureStopBody()):
    reason = (body.reason or "api").strip() or "api"
    result = capture_manager.stop_recording(reason=reason)
    code = 200 if result.get("ok") else 400
    return JSONResponse(status_code=code, content={"code": code, **result, "timestamp": datetime.now().isoformat()})


@router.get("/status")
async def capture_status():
    st = capture_manager.status()
    return JSONResponse(content={"code": 200, **st, "timestamp": datetime.now().isoformat()})


@router.get("/file")
async def capture_file(name: str = Query(..., description="CSV 文件名")):
    safe = Path(name).name
    if not safe.endswith(".csv"):
        return JSONResponse(status_code=400, content={"code": 400, "message": "仅支持 .csv 文件"})
    path = (DATA_DIR / safe).resolve()
    if not str(path).startswith(str(DATA_DIR.resolve())):
        return JSONResponse(status_code=400, content={"code": 400, "message": "非法路径"})
    if not path.is_file():
        return JSONResponse(status_code=404, content={"code": 404, "message": "文件不存在"})
    return FileResponse(path, media_type="text/csv", filename=safe)


def _resolve_csv_path(name: str) -> tuple[Optional[Path], Optional[str]]:
    safe = Path(name).name
    if not safe.endswith(".csv"):
        return None, "仅支持 .csv 文件"
    path = (DATA_DIR / safe).resolve()
    if not str(path).startswith(str(DATA_DIR.resolve())):
        return None, "非法路径"
    if not path.is_file():
        return None, "文件不存在"
    return path, None


@router.post("/upload")
async def capture_upload(request: Request):
    """
    上传 CSV 到 DataLink（封装 探鸟雷达数据上传.md）。

    支持三种方式（任选其一）：
    1. JSON：`{"filename": "tracks_xxx.csv"}` — 上传采集目录内已有文件（推荐，stop 后直接传文件名）
    2. multipart：`name=tracks_xxx.csv` — 同上
    3. multipart：`file` + 可选 `fileName` — 上传请求体中的 CSV 字节
    """
    file_bytes: Optional[bytes] = None
    upload_name = ""

    content_type = (request.headers.get("content-type") or "").lower()

    if "application/json" in content_type:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse(status_code=400, content={"code": 400, "ok": False, "message": "JSON 解析失败"})
        if not isinstance(body, dict):
            return JSONResponse(status_code=400, content={"code": 400, "ok": False, "message": "无效 JSON"})
        upload_name = str(body.get("filename") or body.get("name") or "").strip()
        if not upload_name:
            return JSONResponse(
                status_code=400,
                content={"code": 400, "ok": False, "message": "缺少 filename"},
            )
        path, err = _resolve_csv_path(upload_name)
        if err:
            return JSONResponse(status_code=400 if err != "文件不存在" else 404, content={"code": 400, "ok": False, "message": err})
        file_bytes = path.read_bytes()
        upload_name = path.name
    else:
        form = await request.form()
        upload_file = form.get("file")
        name_field = form.get("name") or form.get("fileName") or form.get("filename")
        if upload_file is not None and hasattr(upload_file, "read"):
            raw = await upload_file.read()
            if not raw:
                return JSONResponse(status_code=400, content={"code": 400, "ok": False, "message": "缺少 CSV 文件内容"})
            file_bytes = raw
            upload_name = str(form.get("fileName") or form.get("filename") or getattr(upload_file, "filename", "") or "").strip()
            if not upload_name:
                upload_name = "tracks_upload.csv"
        elif name_field:
            upload_name = str(name_field).strip()
            path, err = _resolve_csv_path(upload_name)
            if err:
                return JSONResponse(
                    status_code=400 if err != "文件不存在" else 404,
                    content={"code": 400, "ok": False, "message": err},
                )
            file_bytes = path.read_bytes()
            upload_name = path.name
        else:
            return JSONResponse(
                status_code=400,
                content={"code": 400, "ok": False, "message": "请提供 file 或 name/filename"},
            )

    result = await upload_bird_radar_csv_to_datalink(file_bytes or b"", upload_name)
    code = 200 if result.get("ok") else 502
    return JSONResponse(
        status_code=code,
        content={
            "code": code,
            **result,
            "repoPath": result.get("repo_path"),
            "timestamp": datetime.now().isoformat(),
        },
    )
