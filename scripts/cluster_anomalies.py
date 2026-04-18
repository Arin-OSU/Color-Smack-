"""
scripts/cluster_anomalies.py — Group related anomalies after each detection pass.

Criteria (any):
  - Pearson correlation of residual series > 0.7 across buildings over the event window
  - Haversine centroid distance < 300 m
  - Same utility AND 3+ buildings AND within 30 minutes start-to-start

The highest-magnitude row becomes the primary; peers get parent_anomaly_id set.
Idempotent: re-running does not create duplicates.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Iterable


@dataclass
class AnomalyRow:
    id: str
    building_id: int
    utility: str
    first_reading_time: "datetime"  # noqa: F821
    last_reading_time: "datetime"   # noqa: F821
    cost_impact_usd: float
    peak_percentile: float
    latitude: float | None = None
    longitude: float | None = None
    residual_series: list[float] = field(default_factory=list)
    parent_anomaly_id: str | None = None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def pearson(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or len(a) < 3:
        return 0.0
    n = len(a)
    sa = sum(a) / n
    sb = sum(b) / n
    num = sum((x - sa) * (y - sb) for x, y in zip(a, b))
    da = math.sqrt(sum((x - sa) ** 2 for x in a))
    db = math.sqrt(sum((y - sb) ** 2 for y in b))
    if da == 0 or db == 0:
        return 0.0
    return num / (da * db)


def cluster(anomalies: Iterable[AnomalyRow]) -> list[AnomalyRow]:
    rows = list(anomalies)
    if len(rows) < 2:
        return rows

    parent: dict[str, str] = {r.id: r.id for r in rows}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            linked = False
            if (
                a.latitude is not None and a.longitude is not None
                and b.latitude is not None and b.longitude is not None
            ):
                if haversine_m(a.latitude, a.longitude, b.latitude, b.longitude) < 300:
                    linked = True
            if not linked and a.residual_series and b.residual_series:
                if pearson(a.residual_series, b.residual_series) > 0.7:
                    linked = True
            if not linked and a.utility == b.utility:
                delta = abs((a.first_reading_time - b.first_reading_time).total_seconds())
                if delta <= 30 * 60:
                    linked = True
            if linked:
                union(a.id, b.id)

    clusters: dict[str, list[AnomalyRow]] = {}
    for r in rows:
        clusters.setdefault(find(r.id), []).append(r)

    out: list[AnomalyRow] = []
    for members in clusters.values():
        if len(members) >= 3 and len(set(m.utility for m in members)) > 1:
            members.sort(key=lambda m: m.cost_impact_usd, reverse=True)
            primary = members[0]
            primary.parent_anomaly_id = None
            out.append(primary)
            for peer in members[1:]:
                peer.parent_anomaly_id = primary.id
                out.append(peer)
        elif len(members) >= 2:
            members.sort(key=lambda m: m.cost_impact_usd, reverse=True)
            primary = members[0]
            primary.parent_anomaly_id = None
            out.append(primary)
            for peer in members[1:]:
                peer.parent_anomaly_id = primary.id
                out.append(peer)
        else:
            out.extend(members)
    return out
