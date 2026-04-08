from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import Conversation, Message
from schemas import ConversationCreate, ConversationDetail, ConversationOut, ConversationUpdate

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation)
        .order_by(Conversation.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    db: AsyncSession = Depends(get_db),
):
    conv = Conversation(title=body.title, model=body.model, system_prompt=body.system_prompt)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@router.get("/{conv_id}", response_model=ConversationDetail)
async def get_conversation(conv_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv_id)
        .options(selectinload(Conversation.messages))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "会话不存在")
    return conv


@router.patch("/{conv_id}", response_model=ConversationOut)
async def update_conversation(
    conv_id: str,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
):
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "会话不存在")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(conv, field, value)
    await db.commit()
    await db.refresh(conv)
    return conv


@router.delete("/{conv_id}", status_code=204)
async def delete_conversation(conv_id: str, db: AsyncSession = Depends(get_db)):
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "会话不存在")
    await db.delete(conv)
    await db.commit()


@router.delete("/{conv_id}/messages", status_code=204)
async def clear_messages(conv_id: str, db: AsyncSession = Depends(get_db)):
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "会话不存在")
    await db.execute(sa_delete(Message).where(Message.conversation_id == conv_id))
    await db.commit()
