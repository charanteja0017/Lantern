"""Core orchestration primitives used across the Strix runtime.

This package is intentionally lightweight: it hosts cross-cutting concerns
like pipeline contracts, schema validators, and report artifact descriptors
that other subsystems (``api``, ``tools``, ``agents``) depend on but that do
not belong inside any single subsystem.
"""
