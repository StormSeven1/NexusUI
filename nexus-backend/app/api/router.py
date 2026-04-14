from fastapi import APIRouter

from app.api.routes import chat, conversations, simulation

api_router = APIRouter()
api_router.include_router(conversations.router)
api_router.include_router(chat.router)
api_router.include_router(simulation.router)
