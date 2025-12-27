"""Error handling utilities for consistent exception handling across the API"""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Callable, TypeVar

from fastapi import HTTPException

from services.api.enums import ErrorMessages

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


def handle_key_error(
    status_code: int = 404,
    detail: str = ErrorMessages.TAB_NOT_FOUND
) -> Callable[[F], F]:
    """
    Decorator that catches KeyError and raises HTTPException with 404.
    
    Usage:
        @handle_key_error(404, "Tab nicht gefunden")
        async def my_function():
            ...
    """
    def decorator(func: F) -> F:
        @wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return await func(*args, **kwargs)
            except KeyError:
                raise HTTPException(status_code=status_code, detail=detail)
        
        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return func(*args, **kwargs)
            except KeyError:
                raise HTTPException(status_code=status_code, detail=detail)
        
        # Return async or sync wrapper based on function type
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper  # type: ignore[return-value]
        return sync_wrapper  # type: ignore[return-value]
    
    return decorator


def handle_runtime_error(
    status_code: int = 409,
    detail: str | None = None
) -> Callable[[F], F]:
    """
    Decorator that catches RuntimeError and raises HTTPException with 409 (Conflict).
    
    Usage:
        @handle_runtime_error(409)
        async def my_function():
            ...
    """
    def decorator(func: F) -> F:
        @wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return await func(*args, **kwargs)
            except RuntimeError as exc:
                error_detail = detail if detail is not None else str(exc)
                raise HTTPException(status_code=status_code, detail=error_detail)
        
        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return func(*args, **kwargs)
            except RuntimeError as exc:
                error_detail = detail if detail is not None else str(exc)
                raise HTTPException(status_code=status_code, detail=error_detail)
        
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper  # type: ignore[return-value]
        return sync_wrapper  # type: ignore[return-value]
    
    return decorator


def handle_generic_error(
    status_code: int = 500,
    detail_prefix: str = "Interner Serverfehler",
    log_error: bool = True
) -> Callable[[F], F]:
    """
    Decorator that catches generic exceptions and raises HTTPException with 500.
    
    Usage:
        @handle_generic_error(500, "Fehler beim Verarbeiten")
        async def my_function():
            ...
    """
    def decorator(func: F) -> F:
        @wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return await func(*args, **kwargs)
            except HTTPException:
                raise
            except Exception as exc:
                if log_error:
                    logger.error(f"{detail_prefix} in {func.__name__}: {exc}", exc_info=True)
                raise HTTPException(status_code=status_code, detail=f"{detail_prefix}: {exc}")
        
        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return func(*args, **kwargs)
            except HTTPException:
                raise
            except Exception as exc:
                if log_error:
                    logger.error(f"{detail_prefix} in {func.__name__}: {exc}", exc_info=True)
                raise HTTPException(status_code=status_code, detail=f"{detail_prefix}: {exc}")
        
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper  # type: ignore[return-value]
        return sync_wrapper  # type: ignore[return-value]
    
    return decorator


def raise_not_found(detail: str) -> None:
    """Raise a 404 HTTPException with the given detail"""
    raise HTTPException(status_code=404, detail=detail)


def raise_bad_request(detail: str) -> None:
    """Raise a 400 HTTPException with the given detail"""
    raise HTTPException(status_code=400, detail=detail)


def raise_conflict(detail: str) -> None:
    """Raise a 409 HTTPException with the given detail"""
    raise HTTPException(status_code=409, detail=detail)


def raise_internal_error(detail: str, exc: Exception | None = None) -> None:
    """Raise a 500 HTTPException with the given detail"""
    if exc:
        logger.error(f"{detail}: {exc}", exc_info=True)
    raise HTTPException(status_code=500, detail=detail)
