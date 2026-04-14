"""
向后兼容层：将旧的 TOOL_DEFINITIONS / TRACKS / execute_tool 映射到新架构。
新代码应直接使用 tool_registry.registry 和 simulation.sim_engine。
"""

from app.services.simulation import sim_engine
from app.services.tool_registry import registry


def get_tool_definitions():
    return registry.definitions


def get_tracks():
    return sim_engine.get_tracks()


def execute_tool(name, args):
    return registry.execute(name, args)


TOOL_DEFINITIONS = property(lambda self: registry.definitions)
TRACKS = property(lambda self: sim_engine.get_tracks())
