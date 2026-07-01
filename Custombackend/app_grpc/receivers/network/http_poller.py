"""
HTTP轮询器 - 定时轮询HTTP接口获取数据
"""
import asyncio
import aiohttp
from typing import Callable, Optional, Dict, Any
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
    
    async def _poll_once(self):
        """执行一次轮询"""
        if not self.session:
            return
        
        headers = dict(self.headers)
        
        # 处理认证
        if self.auth:
            auth_type = self.auth.get('type', '').lower()
            if auth_type == 'bearer':
                headers['Authorization'] = f"Bearer {self.auth.get('token', '')}"
            elif auth_type == 'basic':
                import base64
                credentials = f"{self.auth.get('username', '')}:{self.auth.get('password', '')}"
                encoded = base64.b64encode(credentials.encode()).decode()
                headers['Authorization'] = f"Basic {encoded}"
        
        try:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            async with self.session.request(
                self.method,
                self.url,
                headers=headers,
                params=self.params,
                timeout=timeout
            ) as response:
                if response.status == 200:
                    data = await response.read()
                    # print("aiohttp:",data)
                    if data and self.callback:
                        try:
                            self.callback(data, self.id)
                        except Exception as e:
                            logger.error(f"处理HTTP数据出错 [{self.id}]: {e}")
                else:
                    logger.warning(f"HTTP请求失败 [{self.id}]: status={response.status}")
        except asyncio.TimeoutError:
            logger.warning(f"HTTP请求超时 [{self.id}]")
        except aiohttp.ClientError as e:
            logger.warning(f"HTTP请求错误 [{self.id}]: {e}")
