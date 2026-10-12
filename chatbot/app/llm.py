"""
The only file that talks to Groq.

Two models (both set in .env):
  FAST_LLM_MODEL  (gpt-oss-20b)   small jobs that must return JSON: routing, rewriting, planning
  LLM_MODEL       (gpt-oss-120b)  writing the reply the customer reads, and choosing order tools

ask_json() is how we get *structured* output we can trust:
  1. ask for JSON only (response_format json_object),
  2. validate it against a pydantic model (wrong types / unknown values -> rejected),
  3. one retry with the validation error shown to the model,
  4. still bad -> raise LLMError, and the caller falls back to simple rules.
"""
import json
import logging
from functools import lru_cache

from pydantic import BaseModel, ValidationError

from app import config

log = logging.getLogger("llm")


class LLMError(Exception):
    pass


def enabled():
    return bool(config.GROQ_API_KEY)


@lru_cache(maxsize=None)
def _client():
    from groq import Groq
    return Groq(api_key=config.GROQ_API_KEY, timeout=config.LLM_TIMEOUT_SECONDS)


def _options(model):
    # gpt-oss models "think" before answering; low effort keeps replies quick
    return {"reasoning_effort": "low"} if "gpt-oss" in model else {}


def chat(messages, model=None, tools=None, max_tokens=1024, temperature=0.2):
    """One chat completion. Returns the message object (.content, .tool_calls)."""
    if not enabled():
        raise LLMError("GROQ_API_KEY is not set")
    model = model or config.LLM_MODEL
    options = {"model": model, "messages": messages, "temperature": temperature,
               "max_tokens": max_tokens, **_options(model)}
    if tools:
        options["tools"] = tools
        options["tool_choice"] = "auto"
    try:
        return _client().chat.completions.create(**options).choices[0].message
    except Exception as err:
        raise LLMError(f"{type(err).__name__}: {err}") from err


def ask_json(system, user, schema: type[BaseModel], model=None):
    """Ask for JSON matching `schema`. Returns a validated schema instance."""
    model = model or config.FAST_LLM_MODEL
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for attempt in (1, 2):
        if not enabled():
            raise LLMError("GROQ_API_KEY is not set")
        try:
            reply = _client().chat.completions.create(
                model=model, messages=messages, temperature=0, max_tokens=800,
                response_format={"type": "json_object"}, **_options(model))
            text = reply.choices[0].message.content or ""
        except Exception as err:
            raise LLMError(f"{type(err).__name__}: {err}") from err
        try:
            return schema.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as err:
            log.warning("bad JSON from %s (attempt %s): %s", model, attempt, str(err)[:300])
            messages += [{"role": "assistant", "content": text[:2000]},
                         {"role": "user", "content": f"That JSON was invalid: {str(err)[:500]}. Reply again with valid JSON only."}]
    raise LLMError("the model did not return valid JSON")
