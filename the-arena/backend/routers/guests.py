"""Guests router — list and query available debate guests."""

import os
import json
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel

router = APIRouter(prefix="/guests", tags=["guests"])

# Will be populated at startup
_guest_registry: Dict[str, Dict] = {}


def register_guests(podcasts: List[Dict]):
    """Register all guests from parsed podcast data."""
    global _guest_registry
    for podcast in podcasts:
        guest = podcast.get("guest")
        if guest and guest != "Lenny Rachitsky":
            if guest not in _guest_registry:
                _guest_registry[guest] = {
                    "name": guest,
                    "title": podcast.get("title", ""),
                    "description": podcast.get("description", ""),
                    "tags": podcast.get("tags", []),
                    "date": podcast.get("date", ""),
                    "youtube_url": podcast.get("youtube_url", ""),
                    "video_id": podcast.get("video_id", ""),
                    "episode_count": 1
                }
            else:
                _guest_registry[guest]["episode_count"] += 1


@router.get("/", response_model=List[Dict])
async def list_guests(tag: Optional[str] = None):
    """
    List all available guests, optionally filtered by tag.
    Returns empty list while backend is still initialising — the frontend
    will poll /health until initialising=false then re-fetch.
    """
    import app_state
    if getattr(app_state, "initialising", True):
        # Signal to the client that we're not ready yet without blocking
        from fastapi.responses import JSONResponse
        return JSONResponse(content=[], headers={"X-Arena-Initialising": "true"})

    guests = list(_guest_registry.values())
    if tag:
        guests = [g for g in guests if tag in g.get("tags", [])]
    return sorted(guests, key=lambda x: x["name"])


@router.get("/tags")
async def list_tags():
    """Get all unique tags across guests."""
    tags = set()
    for guest in _guest_registry.values():
        tags.update(guest.get("tags", []))
    return sorted(list(tags))


@router.get("/{guest_name}")
async def get_guest(guest_name: str):
    """Get details for a specific guest."""
    # Try exact match first
    if guest_name in _guest_registry:
        return _guest_registry[guest_name]

    # Try case-insensitive match
    for name, data in _guest_registry.items():
        if name.lower() == guest_name.lower():
            return data

    raise HTTPException(status_code=404, detail=f"Guest '{guest_name}' not found")


@router.get("/suggest/pairs")
async def suggest_debate_pairs(topic: Optional[str] = None):
    """Suggest interesting guest pairings for a topic."""
    from debate.personas import SUGGESTED_TOPICS

    if topic:
        # Find topic-specific suggestions
        for t in SUGGESTED_TOPICS:
            if topic.lower() in t["title"].lower() or topic.lower() in t["id"]:
                available = [g for g in t.get("suggested_guests", []) if g in _guest_registry]
                return {"topic": t, "available_guests": available}

    # Return all topic suggestions with availability
    results = []
    for t in SUGGESTED_TOPICS:
        available = [g for g in t.get("suggested_guests", []) if g in _guest_registry]
        if len(available) >= 2:
            results.append({**t, "available_guests": available})

    return results
