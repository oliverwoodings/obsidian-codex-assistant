export interface SessionRunSnapshot {
	sessionId: string;
	assistantMessageId: string;
	executionLogId: string;
	startedAt: number;
	cancelRequested: boolean;
}

interface SessionRunRegistration extends SessionRunSnapshot {
	cancel: () => void;
}

export class SessionRunRegistry {
	private readonly runs = new Map<string, SessionRunRegistration>();

	beginRun(sessionId: string, registration: Omit<SessionRunRegistration, "sessionId">): boolean {
		if (!sessionId || this.runs.has(sessionId)) {
			return false;
		}
		this.runs.set(sessionId, {
			sessionId,
			assistantMessageId: registration.assistantMessageId,
			executionLogId: registration.executionLogId,
			startedAt: registration.startedAt,
			cancelRequested: registration.cancelRequested,
			cancel: registration.cancel
		});
		return true;
	}

	getRun(sessionId: string): SessionRunSnapshot | undefined {
		const run = this.runs.get(sessionId);
		return run ? this.toSnapshot(run) : undefined;
	}

	getSessionIds(): string[] {
		return [...this.runs.keys()];
	}

	getRunningSessionIds(): string[] {
		return this.getSessionIds();
	}

	isSessionRunning(sessionId: string): boolean {
		return this.runs.has(sessionId);
	}

	findSessionIdByExecutionLogId(executionLogId: string): string | undefined {
		for (const [sessionId, run] of this.runs.entries()) {
			if (run.executionLogId === executionLogId) {
				return sessionId;
			}
		}
		return undefined;
	}

	getRunByExecutionLogId(executionLogId: string): SessionRunSnapshot | undefined {
		const sessionId = this.findSessionIdByExecutionLogId(executionLogId);
		return sessionId ? this.getRun(sessionId) : undefined;
	}

	cancelRun(sessionId: string): boolean {
		const run = this.runs.get(sessionId);
		if (!run) {
			return false;
		}
		run.cancelRequested = true;
		run.cancel();
		return true;
	}

	cancelRunByExecutionLogId(executionLogId: string): boolean {
		const sessionId = this.findSessionIdByExecutionLogId(executionLogId);
		if (!sessionId) {
			return false;
		}
		return this.cancelRun(sessionId);
	}

	adoptResolvedSessionId(previousSessionId: string, resolvedSessionId: string): void {
		if (!previousSessionId || !resolvedSessionId || previousSessionId === resolvedSessionId) {
			return;
		}
		const run = this.runs.get(previousSessionId);
		if (!run) {
			return;
		}
		this.runs.delete(previousSessionId);
		this.runs.set(resolvedSessionId, {
			...run,
			sessionId: resolvedSessionId
		});
	}

	completeRun(sessionId: string): SessionRunSnapshot | undefined {
		const run = this.runs.get(sessionId);
		if (!run) {
			return undefined;
		}
		this.runs.delete(sessionId);
		return this.toSnapshot(run);
	}

	cancelAllRuns(): void {
		for (const run of this.runs.values()) {
			run.cancelRequested = true;
			run.cancel();
		}
	}

	private toSnapshot(run: SessionRunRegistration): SessionRunSnapshot {
		return {
			sessionId: run.sessionId,
			assistantMessageId: run.assistantMessageId,
			executionLogId: run.executionLogId,
			startedAt: run.startedAt,
			cancelRequested: run.cancelRequested
		};
	}
}
