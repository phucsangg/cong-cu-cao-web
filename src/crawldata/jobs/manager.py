import asyncio
from typing import Any


class JobManager:
    def __init__(self):
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = asyncio.Lock()

    async def register_job(self, job_id: str, config: dict) -> dict[str, Any]:
        async with self.lock:
            job = {
                "id": job_id,
                "status": "running",
                "sheetUrl": config.get("sheetUrl"),
                "sheetName": config.get("sheetName"),
                "startRow": max(3, int(config.get("startRow") or 3)),
                "endRow": int(config.get("endRow")) if config.get("endRow") else None,
                "specificRowsEnabled": bool(config.get("specificRowsEnabled")),
                "scanToEndEnabled": bool(config.get("scanToEndEnabled")),
                "specific_rows": config.get("specificRows") or "",
                "rowsConcurrency": max(1, int(config.get("rowsConcurrency") or 2)),
                "linksConcurrency": max(1, int(config.get("linksConcurrency") or 4)),
                "batchSize": max(1, int(config.get("batchSize") or 10)),
                "totalRows": 0,
                "processedCount": 0,
                "successCount": 0,
                "errorCount": 0,
                "writeCount": 0,
                "logs": [],
                "rows": [],
                "stopRequested": False,
                "lastResult": None,
            }
            self.jobs[job_id] = job
            return job

    async def get_job(self, job_id: str) -> dict[str, Any] | None:
        async with self.lock:
            return self.jobs.get(job_id)

    async def stop_job(self, job_id: str) -> bool:
        async with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return False
            job["stopRequested"] = True
            return True

    async def get_job_status(self, job_id: str) -> dict[str, Any] | None:
        job = await self.get_job(job_id)
        if not job:
            return None
        return {
            "id": job["id"],
            "status": job["status"],
            "totalRows": job["totalRows"],
            "processedCount": job["processedCount"],
            "successCount": job["successCount"],
            "errorCount": job["errorCount"],
            "writeCount": job["writeCount"],
            "logs": list(job["logs"]),
            "rows": list(job["rows"]),
            "lastResult": job["lastResult"],
        }


job_manager = JobManager()
