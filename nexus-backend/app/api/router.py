from fastapi import APIRouter

from app.api.routes import assets, chat, conversations, simulation, zones

api_router = APIRouter()
api_router.include_router(conversations.router)
api_router.include_router(chat.router)
api_router.include_router(simulation.router)
api_router.include_router(zones.router)
api_router.include_router(assets.router)
