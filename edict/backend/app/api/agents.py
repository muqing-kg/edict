"""Agents API — Agent 配置和状态查询。"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter

log = logging.getLogger("edict.api.agents")
router = APIRouter()

# Agent 元信息（对应 agents/ 目录下的 SOUL.md）
AGENT_META = {
    "main": {"name": "云霄", "role": "入口分拣核心", "icon": "🧭"},
    "tianyan": {"name": "天眼", "role": "态势汇聚与议程管理", "icon": "🛰️"},
    "zhongji": {"name": "中继", "role": "总协调与任务监督", "icon": "📡"},
    "xingshu": {"name": "星枢", "role": "方案起草与规划中枢", "icon": "🧠"},
    "lengjing": {"name": "棱镜", "role": "审核校核与拦截把关", "icon": "🔍"},
    "wenshu": {"name": "文枢", "role": "文档整理与表达输出", "icon": "📝"},
    "xulie": {"name": "序列", "role": "人事与组织编排", "icon": "👤"},
    "yuanliu": {"name": "源流", "role": "资源与数据管理", "icon": "💰"},
    "jiwu": {"name": "机务", "role": "工程与技术实施", "icon": "🔧"},
    "tanzhen": {"name": "探针", "role": "规范与质量审查", "icon": "⚖️"},
    "weikong": {"name": "维控", "role": "执行安全与应急响应", "icon": "🛡️"},
}


@router.get("")
async def list_agents():
    """列出所有可用 Agent。"""
    agents = []
    for agent_id, meta in AGENT_META.items():
        agents.append({
            "id": agent_id,
            **meta,
        })
    return {"agents": agents}


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """获取 Agent 详情。"""
    meta = AGENT_META.get(agent_id)
    if not meta:
        return {"error": f"Agent '{agent_id}' not found"}, 404

    # 尝试读取 SOUL.md
    soul_path = Path(__file__).parents[4] / "agents" / agent_id / "SOUL.md"
    soul_content = ""
    if soul_path.exists():
        soul_content = soul_path.read_text(encoding="utf-8")[:2000]

    return {
        "id": agent_id,
        **meta,
        "soul_preview": soul_content,
    }


@router.get("/{agent_id}/config")
async def get_agent_config(agent_id: str):
    """获取 Agent 运行时配置。"""
    config_path = Path(__file__).parents[4] / "data" / "agent_config.json"
    if not config_path.exists():
        return {"agent_id": agent_id, "config": {}}

    try:
        configs = json.loads(config_path.read_text(encoding="utf-8"))
        agent_config = configs.get(agent_id, {})
        return {"agent_id": agent_id, "config": agent_config}
    except (json.JSONDecodeError, IOError):
        return {"agent_id": agent_id, "config": {}}
