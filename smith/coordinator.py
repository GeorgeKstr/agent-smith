from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Generator

from .agent import stream_agent, ApprovalHandler
from .compaction import auto_compact_run
from .db import ProjectDB, json_loads
from .indexer import index_file, scan_project
from .registry import classify_prompt


class ProjectCoordinator:
    def __init__(self, root_path: str | Path):
        self.db = ProjectDB(root_path)
        self.db.init()
        self._run_lock = threading.Lock()
        self._worker_thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start_worker(self) -> None:
        if self._worker_thread and self._worker_thread.is_alive():
            return
        self._stop.clear()
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker_thread.start()

    def stop_worker(self) -> None:
        self._stop.set()

    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            if self.db.is_index_paused():
                time.sleep(0.5)
                continue
            job = self.db.next_job(include_background=True)
            if not job:
                self.db.refresh_index_counters(message="Ready")
                time.sleep(0.5)
                continue
            # One job at a time. User tasks acquire the same lock and jump in after current file job.
            with self._run_lock:
                self.run_job(job)

    def run_job(self, job: dict[str, Any]) -> None:
        job_id = job["id"]
        kind = job["kind"]
        payload = json_loads(job.get("payload_json") or "{}", {})
        self.db.start_job(job_id)
        try:
            if kind == "index_project_scan":
                queued = scan_project(self.db)
                self.db.record_event(None, "index_scan_finished", {"queued": queued})
            elif kind == "index_file":
                result = index_file(self.db, payload["path"])
                self.db.record_event(None, "index_file_finished", result)
            elif kind == "refresh_project_summary":
                self.refresh_project_summary()
            else:
                self.db.record_event(None, "job_skipped", {"kind": kind, "payload": payload})
            self.db.finish_job(job_id, "done")
            self.db.refresh_index_counters(message="Ready")
        except Exception as exc:
            self.db.finish_job(job_id, "error", error=str(exc))
            self.db.refresh_index_counters(message=f"Error: {exc}")
            self.db.record_event(None, "job_error", {"kind": kind, "error": str(exc)})

    def enqueue_scan(self) -> str:
        return self.db.enqueue_job("index_project_scan", priority=5, payload={})

    def enqueue_index_file(self, path: str, priority: int = 2) -> str:
        return self.db.enqueue_job("index_file", priority=priority, payload={"path": path})

    def pause_indexing(self) -> None:
        self.db.set_index_paused(True)

    def resume_indexing(self) -> None:
        self.db.set_index_paused(False)

    def refresh_project_summary(self) -> None:
        rows = self.db.search_file_summaries("main app server config cli database", limit=20)
        if not rows:
            content = "Project has not been indexed enough to build a summary yet."
        else:
            bullets = "\n".join(f"- {r['path']}: {r['summary'][:300]}" for r in rows)
            content = f"Indexed project files suggest this structure:\n{bullets}"
        self.db.upsert_context_item("project_summary", "Project Summary", content, priority=10)

    def stream_user_task(
        self,
        prompt: str,
        task_type: str | None = None,
        review_mode: str = "auto",
        model_override: dict[str, str] | None = None,
        review_model_override: dict[str, str] | None = None,
        cancel_event: threading.Event | None = None,
        approval_handler: ApprovalHandler | None = None,
    ) -> Generator[str, None, None]:
        task_type = task_type or classify_prompt(prompt)
        # User tasks wait only for the current small index/tool unit.
        with self._run_lock:
            # Collect all output to detect the run_id at the end
            output_chunks: list[str] = []
            for chunk in stream_agent(
                self.db,
                prompt=prompt,
                task_type=task_type,
                review_mode=review_mode,
                model_override=model_override,
                cancel_event=cancel_event,
                approval_handler=approval_handler,
            ):
                output_chunks.append(chunk)
                yield chunk

            # Auto-compact if the last run was an implementation
            if task_type in ("implement", "fix", "refactor"):
                try:
                    latest_run = self.db.recent_runs(limit=1)
                    if latest_run:
                        run = latest_run[0]
                        run_id = run["id"]
                        if run.get("full_transcript"):
                            entry = auto_compact_run(self.db, run_id, transcript=run["full_transcript"])
                            if entry:
                                yield f"\n[smith] compacted run {run_id[:12]} — saved {entry.token_count} tokens of context\n"
                except Exception as exc:
                    # Compaction is best-effort; don't fail the task
                    self.db.record_event(None, "compaction_error", {"error": str(exc)})
            if review_mode in {"always"} and task_type == "implement":
                review_prompt = (
                    "Review the most recent Smith changes for correctness, missed requirements, "
                    "safety issues, and whether checks are sufficient. Return a concise review report."
                )
                yield "\n\n--- Review ---\n"
                yield from stream_agent(
                    self.db,
                    prompt=review_prompt,
                    task_type="review",
                    review_mode="never",
                    model_override=review_model_override,
                    cancel_event=cancel_event,
                )
