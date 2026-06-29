"""
HTTP轮询器 - 定时轮询HTTP接口获取数据
"""
import asyncio
import json
import aiohttp
from typing import Callable, Optional, Dict, Any, List
from loguru import logger


class HTTPPoller:
    """HTTP轮询接收器"""
    
    def __init__(self, config: Dict[str, Any], callback: Callable[[bytes, str], None]):
        """
        Args:
            config: 轮询配置
            callback: 数据回调函数 callback(data, poller_id)
        """
        self.id = config.get('id', 'unknown')
        self.name = config.get('name', '')
        self.url = config.get('url', '')
        self.method = config.get('method', 'GET').upper()
        self.poll_interval = config.get('poll_interval', 1.0)
        self.data_format = config.get('data_format', 'FusionTrack')
        self.headers = config.get('headers', {})
        self.params = config.get('params', {})
        self.auth = config.get('auth')
        self.timeout = config.get('timeout', 10)
        # EntityStatus 等分页 API：合并全部页后再回调（避免第 2 页实体缺失，如 uav-011）
        self.fetch_all_pages = bool(config.get('fetch_all_pages', False))
        
        self.callback = callback
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def start(self):
        """启动轮询器"""
        if self.running:
            return
        
        self.running = True
        self.session = aiohttp.ClientSession()
        self.task = asyncio.create_task(self._poll_loop())
        logger.info(f"HTTP轮询器已启动: [{self.id}] {self.name} -> {self.url}")
    
    async def stop(self):
        """停止轮询器"""
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None
        if self.session:
            await self.session.close()
            self.session = None
        logger.info(f"HTTP轮询器已停止: [{self.id}] {self.name}")
    
    async def _poll_loop(self):
        """轮询循环"""
        while self.running:
            try:
                await self._poll_once()
            except Exception as e:
                logger.error(f"HTTP轮询出错 [{self.id}]: {e}")
            await asyncio.sleep(self.poll_interval)
    
    def _build_auth_headers(self) -> Dict[str, str]:
        headers = dict(self.headers)
        if self.auth:
            auth_type = self.auth.get('type', '').lower()
            if auth_type == 'bearer':
                headers['Authorization'] = f"Bearer {self.auth.get('token', '')}"
            elif auth_type == 'basic':
                import base64
                credentials = f"{self.auth.get('username', '')}:{self.auth.get('password', '')}"
                encoded = base64.b64encode(credentials.encode()).decode()
                headers['Authorization'] = f"Basic {encoded}"
        return headers

    async def _request_json(self, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.session:
            return None
        headers = self._build_auth_headers()
        try:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            async with self.session.request(
                self.method,
                self.url,
                headers=headers,
                params=params,
                timeout=timeout,
            ) as response:
                if response.status != 200:
                    logger.warning(f"HTTP请求失败 [{self.id}]: status={response.status}")
                    return None
                raw = await response.read()
                if not raw:
                    return None
                payload = json.loads(raw.decode('utf-8'))
                return payload if isinstance(payload, dict) else None
        except asyncio.TimeoutError:
            logger.warning(f"HTTP请求超时 [{self.id}]")
        except aiohttp.ClientError as e:
            logger.warning(f"HTTP请求错误 [{self.id}]: {e}")
        except json.JSONDecodeError as e:
            logger.error(f"HTTP响应 JSON 解析失败 [{self.id}]: {e}")
        return None

    async def _fetch_all_pages_payload(self) -> Optional[bytes]:
        """合并分页 API 的全部 records，供 entity_status 一次解析。"""
        base_params = dict(self.params)
        page_size = int(base_params.get('size', 100) or 100)
        start_page = int(base_params.get('page', 1) or 1)

        merged_records: List[Any] = []
        total_pages = 1
        first_payload: Optional[Dict[str, Any]] = None
        data_section: Dict[str, Any] = {}
        page = start_page

        while page <= total_pages:
            params = {**base_params, 'page': page, 'size': page_size}
            payload = await self._request_json(params)
            if not payload:
                return None
            if first_payload is None:
                first_payload = payload
            section = payload.get('data')
            if not isinstance(section, dict):
                logger.warning(f"HTTP分页响应缺少 data [{self.id}] page={page}")
                return None
            records = section.get('records')
            if not isinstance(records, list):
                logger.warning(f"HTTP分页响应缺少 records [{self.id}] page={page}")
                return None
            merged_records.extend(records)
            data_section = section
            total_pages = max(1, int(section.get('pages', 1) or 1))
            page += 1

        if first_payload is None:
            return None

        merged = dict(first_payload)
        merged_data = dict(data_section)
        merged_data['records'] = merged_records
        merged_data['total'] = merged_data.get('total', len(merged_records))
        merged_data['current'] = 1
        merged_data['pages'] = 1
        merged['data'] = merged_data
        logger.debug(
            f"HTTP分页合并完成 [{self.id}]: {len(merged_records)} 条实体, "
            f"原 {total_pages} 页"
        )
        return json.dumps(merged, ensure_ascii=False).encode('utf-8')

    async def _poll_once(self):
        """执行一次轮询"""
        if not self.session:
            return

        try:
            if self.fetch_all_pages:
                data = await self._fetch_all_pages_payload()
            else:
                payload = await self._request_json(dict(self.params))
                data = (
                    json.dumps(payload, ensure_ascii=False).encode('utf-8')
                    if payload
                    else None
                )

            if data and self.callback:
                try:
                    self.callback(data, self.id)
                except Exception as e:
                    logger.error(f"处理HTTP数据出错 [{self.id}]: {e}")
        except Exception as e:
            logger.error(f"HTTP轮询出错 [{self.id}]: {e}")
