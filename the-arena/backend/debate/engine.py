"""
The Debate Engine — orchestrates multi-turn debates between guests,
grounded in their actual transcript data via RAG.
"""

import os
import asyncio
from typing import List, Dict, Optional, AsyncGenerator
from anthropic import AsyncAnthropic
from .personas import get_persona_system_prompt, get_host_prompt

# Lenny intervenes every N guest turns
LENNY_INTERVENTION_INTERVAL = 2

# Host intervention types cycle
HOST_INTERVENTION_CYCLE = ["follow_up", "challenge", "bridge", "hot_take", "synthesis"]


class DebateEngine:
    def __init__(self, vector_store, model: str = "claude-sonnet-4-6", api_key: Optional[str] = None):
        self.vector_store = vector_store
        self.model = model
        # Allow caller to supply a user-provided key; fall back to env var
        resolved_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self.client = AsyncAnthropic(api_key=resolved_key)
        # Populated by generate_guest_turn before first yield; read by router after loop
        self._last_guest_sources: List[Dict] = []

    def _format_debate_history(self, turns: List[Dict]) -> str:
        """Format debate history for context."""
        if not turns:
            return "The debate is just beginning."

        lines = []
        for turn in turns[-6:]:  # Last 6 turns for context window efficiency
            speaker = turn.get("speaker", "Unknown")
            text = turn.get("text", "")
            lines.append(f"**{speaker}**: {text[:400]}{'...' if len(text) > 400 else ''}")

        return "\n\n".join(lines)

    def _build_retrieval_query(self, topic: str, other_last_turn: Optional[str] = None) -> str:
        """Build a rich retrieval query combining topic + context."""
        if other_last_turn:
            # Use key phrases from both topic and the last opposing argument
            return f"{topic}. {other_last_turn[:200]}"
        return topic

    async def generate_guest_turn(
        self,
        guest: str,
        topic: str,
        other_guest: str,
        debate_turns: List[Dict],
        is_opening: bool = False
    ) -> AsyncGenerator[str, None]:
        """
        Generate a single guest debate turn with streaming.
        Yields text chunks as they stream from the API.
        """
        # Get the other guest's last turn if it exists
        other_last_turn = None
        for turn in reversed(debate_turns):
            if turn.get("speaker") == other_guest:
                other_last_turn = turn.get("text")
                break

        # Build retrieval query
        query = self._build_retrieval_query(topic, other_last_turn)

        # Retrieve relevant chunks for this guest
        chunks = self.vector_store.retrieve(guest, query, n_results=5)

        # Store for caller (router reads engine._last_guest_sources after the loop)
        self._last_guest_sources = chunks

        if chunks:
            retrieved_text = "\n\n---\n\n".join([
                f'"{c["text"][:500]}"' for c in chunks[:4]
            ])
        else:
            retrieved_text = f"[No specific transcript data found for {guest} on this topic — respond based on their known expertise and frameworks]"

        # Format debate history
        history = self._format_debate_history(debate_turns)

        # Build system prompt
        system_prompt = get_persona_system_prompt(
            guest=guest,
            topic=topic,
            retrieved_chunks=retrieved_text,
            other_guest=other_guest,
            other_guest_last_turn=other_last_turn,
            debate_history=history if not is_opening else None,
            is_opening=is_opening
        )

        # Stream response from Claude
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=600,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": f"{'Give your opening statement on' if is_opening else 'Respond to'}: {topic}"
                }
            ]
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def generate_host_turn(
        self,
        topic: str,
        guest1: str,
        guest2: str,
        debate_turns: List[Dict],
        turn_number: int
    ) -> AsyncGenerator[str, None]:
        """Generate Lenny's hosting/moderation turn with streaming."""

        history = self._format_debate_history(debate_turns)

        # Cycle through intervention types
        intervention_idx = (turn_number // 2) % len(HOST_INTERVENTION_CYCLE)

        # Use synthesis for the last turn
        is_last = turn_number >= 8
        intervention_type = "synthesis" if is_last else HOST_INTERVENTION_CYCLE[intervention_idx]

        system_prompt = get_host_prompt(
            topic=topic,
            guest1=guest1,
            guest2=guest2,
            debate_history=history,
            host_intervention_type=intervention_type
        )

        async with self.client.messages.stream(
            model=self.model,
            max_tokens=200,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": "What do you say next as the host?"
                }
            ]
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def generate_vote_summary(
        self,
        topic: str,
        guest1: str,
        guest2: str,
        debate_turns: List[Dict],
        vote_counts: Dict[str, int]
    ) -> str:
        """Generate a post-debate summary and verdict."""
        history = self._format_debate_history(debate_turns)

        prompt = f"""The debate on "{topic}" between {guest1} and {guest2} has concluded.

Audience votes: {guest1}: {vote_counts.get(guest1, 0)} | {guest2}: {vote_counts.get(guest2, 0)}

Debate highlights:
{history}

As Lenny, write a brief (3-4 sentences) closing summary:
1. What was the sharpest moment of disagreement?
2. What did they surprisingly agree on?
3. What question was left unresolved?
Keep it punchy and Lenny-esque."""

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text

    def should_lenny_intervene(self, turn_number: int) -> bool:
        """Determine if Lenny should intervene at this turn."""
        return turn_number > 0 and turn_number % LENNY_INTERVENTION_INTERVAL == 0
