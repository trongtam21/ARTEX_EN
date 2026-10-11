package agent

import (
	"context"
	"errors"
	"fmt"
)

// AbortCause names why an agent run's context was cancelled. Every cancellation
// site should attach one so the activity trace can report the real initiator.
type AbortCause struct {
	Code  string
	Short string
	Text  string
}

func (c *AbortCause) Error() string { return c.Text }

func cause(code, short, text string) *AbortCause {
	return &AbortCause{Code: code, Short: short, Text: text}
}

// Causef builds a cause that includes runtime-specific detail.
func Causef(code, short, format string, args ...any) *AbortCause {
	return &AbortCause{Code: code, Short: short, Text: fmt.Sprintf(format, args...)}
}

var (
	// Task-level execution context.
	AbortPausedByUser = cause("paused_by_user", "Task paused by user",
		"The user paused the task through the task-control endpoint (POST /api/tasks/{id}/control, action=pause). The Planner/Worker run was cancelled; its running intent returns to the open frontier and is reclaimed from the beginning when the task resumes.")
	AbortPausedByOrchestrator = cause("paused_by_orchestrator", "Task paused by orchestration agent",
		"The orchestration agent paused this task with pause_task. The Planner/Worker run was cancelled; its running intent returns to the open frontier and is re-executed when the task resumes.")
	AbortTaskDeleted = cause("task_deleted", "Task deleted",
		"The task is being deleted (DELETE /api/tasks/{id}). The deletion barrier cancelled its running Planner, Worker, and main agent; this run result will not be used.")
	AbortPausedOnReload = cause("paused_on_reload", "Task pause state restored by backend",
		"The backend restored the persisted paused state when it started. This run was cancelled; normally no agent is running during restoration.")
	AbortGoalMet = cause("goal_met", "Goal met by Planner",
		"The Planner determined that the task goal was met, marked the task done, and cancelled remaining Workers. Their intents are marked stopped rather than failed.")
	AbortSettleDrainTimeout = cause("settle_drain_timeout", "Task timeout drain period expired",
		"After the task reached timeout, the running Worker was given time to finish gracefully, but the 90-second drain grace period was insufficient and a hard cancellation was issued. The intent is marked exhausted; facts and assets written during wrap-up are preserved.")

	// Per-work context.
	AbortKilledByPlanner = cause("killed_by_planner", "Intent terminated by Planner",
		"The Planner terminated this intent with kill_work, usually because the direction drifted or no longer has value. The intent is marked stopped and is not reclaimed automatically.")
	AbortWorkPausedByUser = cause("work_paused_by_user", "Worker intent paused by user",
		"The user paused the running Worker. This call was cancelled and the intent became paused; its intent, facts, findings, and activity records are preserved and it will restart from the beginning when resumed.")
	AbortWorkCancelledByUser = cause("work_cancelled_by_user", "Worker intent deleted by user",
		"The user deleted the running Worker. This call was cancelled; after the Worker leaves its write section, the server applies the selected deletion mode. Soft deletion marks the intent deleted and preserves all output; hard deletion cascades to the intent and downstream nodes supported only by it.")
	AbortWorkFinished = cause("work_finished", "Worker finished normally",
		"The Worker finished normally and the engine released its context in detachWork. This is not an interruption; if it appears in an interruption message, cancellation raced with cleanup.")
	AbortPausedRaceGuard = cause("paused_race_guard", "New run rejected while task is paused",
		"The engine refuses to create a new execution context while the task is paused, preventing a race between claiming and pausing from starting a Worker. Claimed intents return to the frontier.")

	// Main Agent and standalone conversation contexts.
	AbortChatStoppedByUser = cause("chat_stopped_by_user", "Conversation turn stopped by user",
		"The user clicked stop and cancelled the current main-agent or conversational-agent run. Existing activity records are preserved and another message can be sent.")
	AbortChatPausedWithTask = cause("chat_paused_with_task", "Task pause cancelled chat",
		"When the user pauses the task, its running main-agent conversation is cancelled as well. Existing activity records are preserved; the message is not replayed automatically when the task resumes.")
	AbortChatTurnFinished = cause("chat_turn_finished", "Conversation turn finished",
		"The conversation turn finished normally and the server is releasing its context. This is not an interruption; if it appears in an interruption message, cancellation raced with cleanup.")

	// Process-level and per-run hard backstop.
	AbortShutdown = cause("shutdown", "Backend process shutting down",
		"The backend received SIGINT or SIGTERM and is restarting, updating, or shutting down. All running agents are cancelled; after restart, leftover running intents are reset to open and re-executed.")
	AbortRunHardTimeout = cause("run_hard_timeout", "Run hard timeout triggered",
		"A run exceeded its soft wall-clock budget and additional grace period. A model request or tool likely failed to return, preventing normal turn-boundary wrap-up. Inspect the last tool call that had not returned before interruption.")
)

// AbortReason resolves the named cause attached to a cancelled run context.
func AbortReason(ctx context.Context) (code, short, text string, ok bool) {
	c := context.Cause(ctx)
	if c == nil {
		return "", "", "", false
	}
	var ac *AbortCause
	if errors.As(c, &ac) {
		return ac.Code, ac.Short, ac.Text, true
	}
	switch {
	case errors.Is(c, context.DeadlineExceeded):
		return "deadline_exceeded", "Upstream context reached its deadline",
			"The upstream context reached its deadline, but the owner did not attach a named cause with WithTimeoutCause: " + c.Error(), true
	case errors.Is(c, context.Canceled):
		return "canceled_no_cause", "Cancelling caller did not attach a named cause",
			"The upstream context was cancelled without a named cause via context.WithCancelCause. Register the cause in agent/cancelcause.go and connect it at the cancellation site.", true
	default:
		return "other", firstLine(c.Error(), 80), c.Error(), true
	}
}
