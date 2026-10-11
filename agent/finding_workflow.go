package agent

import (
	"encoding/json"
	"fmt"

	"github.com/Autumn-27/artex/db"
	actool "github.com/Autumn-27/norma/tool"
)

const findingIDGuidance = "\n\n**Finding ID convention**: finding_id is the independent finding-record ID; finding_node_id is the exploration-node ID. The id returned by list_findings / list_task_findings / node_detail / get_task_node_detail remains an exploration-node ID; read the independent finding_id from the same result. get_finding_traffic / bind_finding_traffic use the independent finding_id. The legacy update_finding_report finding_id parameter still receives finding_node_id. Do not use the number on the first line of report_finding as an evidence-tool ID or guess another number after an ID error."

// The server supplies the persisted setting. A missing setting/host is off.
// Consulted at assembly and again on writes so an already-running session
// cannot keep binding after the user switches the feature off.
var FindingTrafficBindingEnabled func() bool

func findingTrafficBindingEnabled() bool {
	return FindingTrafficBindingEnabled != nil && FindingTrafficBindingEnabled()
}

// Applied after ToolResolve: user descriptions and prompts remain intact, while
// all actual reporters (including Planner and custom chat agents) see the same
// API contract. Disabled/unbound tools are never reintroduced here.
func findingWorkflowTools(agentKey string, tools []actool.CoreTool) ([]actool.CoreTool, string) {
	if !findingTrafficBindingEnabled() {
		out := make([]actool.CoreTool, 0, len(tools))
		for _, tool := range tools {
			if tool.Name() == "bind_finding_traffic" {
				continue
			}
			if agentKey == "reporter" && (tool.Name() == "traffic_search" || tool.Name() == "traffic_get" || tool.Name() == "traffic_blob") {
				continue
			}
			switch tool.Name() {
			case "report_finding", "add_hint", "add_task_hint":
				// Work on a copy: toggling back on must restore the original schema.
				raw, _ := json.Marshal(tool.InputSchema())
				var schema map[string]any
				if json.Unmarshal(raw, &schema) == nil {
					stripTrafficParameters(schema)
					tool = DecorateTool(tool, tool.Description(), schema)
				}
			}
			out = append(out, tool)
		}
		return out, ""
	}
	out := append([]actool.CoreTool(nil), tools...)
	has := map[string]bool{}
	for i, tool := range out {
		has[tool.Name()] = true
		note := ""
		switch tool.Name() {
		case "report_finding":
			note = "\nThe Report Writer normally reviews and binds traffic before writing the report. Keep verification commands, key output, existing real traffic IDs, and their purposes in evidence so the Report Writer can compare them with the execution trace; do not capture additional packets solely for binding. Explicit immediate binding remains supported: traffic_refs or evidence_hint_id may submit verified references, and an invalid reference causes the entire report to fail. These optional parameters are not needed for TCP or packetless findings. The result separately identifies finding_id and finding_node_id as the independent record and exploration node."
		case "add_hint", "add_task_hint":
			note = "\nWhen handing off a confirmed finding, preserve verified traffic IDs, roles, notes, and order in traffic_refs on the relevant hint (top-level for one hint, or the matching hints element for a batch), and explain in text which finding it proves. Do not hand off text while discarding existing traffic references. Unverified candidates cannot be passed as evidence."
		case "get_finding_traffic", "bind_finding_traffic", "list_findings", "list_task_findings", "node_detail", "get_task_node_detail", "update_finding_report":
			note = findingIDGuidance
		}
		if note != "" {
			out[i] = DecorateTool(tool, tool.Description()+note, tool.InputSchema())
		}
	}
	guidance := ""
	if has["report_finding"] || has["add_task_hint"] || has["add_hint"] {
		guidance = "\n\n**Optional traffic-evidence handoff**: the Report Writer normally performs automatic binding after a finding is stored and before writing its report. Keep verification commands, key output, existing real traffic IDs, and their purposes in evidence; include intent_id so the Report Writer can trace the work. Do not capture additional packets solely for binding. Auto / Planner must preserve references already supplied by the executor. add_hint / add_task_hint can hand off traffic_refs; report_finding also supports immediate traffic_refs / evidence_hint_id. Register TCP or packetless findings normally, but never guess IDs or probe again merely to capture packets."
		if has["add_task_hint"] && !has["add_hint"] {
			guidance += "\nWhen a platform conversation has no task context, do not call report_finding directly. Hand the finding to the matching task with add_task_hint; the task agent registers it and verifies the result with list_task_findings."
		}
		if has["prove_goal"] || has["goal_met"] {
			guidance += "\nBefore marking a goal complete, finish handing off or registering the available evidence. Do not end the task or cancel a Worker merely because a textual finding was registered while the evidence handoff is incomplete; packetless findings do not require waiting or forced capture."
		}
	}
	if has["update_finding_report"] && has["bind_finding_traffic"] && has["get_finding_traffic"] {
		guidance += "\n\n**Automatic traffic association before reporting (enabled)**: for the finding that triggered this run, review and bind traffic before writing the report. Obtain explicit finding_id and finding_node_id from report_finding JSON or get_task_node_detail / list_task_findings. Read the finding details, the relevant intent trace, and the existing evidence list, prioritizing real IDs handed off by the reporter. For an HTTP verification when traffic tools are available, filter candidates with traffic_search and verify each request/response with traffic_get. Host and time are only filters and do not establish ownership. Bind confirmed evidence in reproduction order with bind_finding_traffic(finding_id, traffic_refs), using baseline / proof / verification / supporting and explaining each role. Only operate on this finding; do not create another finding or probe the target again. After binding, call get_finding_traffic again for the latest version, read the needed bodies, and pass the version actually read as evidence_version to update_finding_report (its finding_id still uses finding_node_id). Existing bindings do not need to be added again. For TCP, unrecorded traffic, unavailable tools, or no exact match, skip automatic binding, write the report from textual/command evidence, and explain why; do not guess to fill traffic gaps. Do not claim a failed binding succeeded; preserve existing evidence and state the reason for missing bindings."
	}
	if guidance != "" || has["get_finding_traffic"] || has["update_finding_report"] {
		guidance += findingIDGuidance
	}
	return out, guidance
}

func stripTrafficParameters(schema map[string]any) {
	props, _ := schema["properties"].(map[string]any)
	delete(props, "traffic_refs")
	delete(props, "evidence_hint_id")
	if required, ok := schema["required"].([]any); ok {
		kept := required[:0]
		for _, key := range required {
			if key != "traffic_refs" && key != "evidence_hint_id" {
				kept = append(kept, key)
			}
		}
		schema["required"] = kept
	}
	if hints, ok := props["hints"].(map[string]any); ok {
		if items, ok := hints["items"].(map[string]any); ok {
			stripTrafficParameters(items)
		}
	}
}

// HintTrafficSchema is shared by the task-local and cross-task hint tools.
func HintTrafficSchema() map[string]any {
	return map[string]any{"type": "array", "description": "Optional verified traffic references that support a specific finding in this hint, preserving order; report_finding can carry them with evidence_hint_id after handoff.", "items": obj(map[string]any{"traffic_id": str("Real traffic ID"), "role": str("baseline / proof / verification / supporting"), "note": str("What conclusion this traffic supports")}, "traffic_id")}
}

func (t *ToolSet) findingRefsFromHint(hintID int64, explicit []db.TrafficRef) ([]db.TrafficRef, error) {
	if hintID <= 0 {
		return db.NormalizeTrafficRefs(explicit)
	}
	n, err := t.ts.GetNode(hintID) // local store only: inherited hints cannot supply evidence
	if err != nil {
		return nil, err
	}
	if n == nil || n.Kind != db.KindHint {
		return nil, fmt.Errorf("evidence_hint_id=%d must be a hint node from this task (inherited hints cannot be bound directly)", hintID)
	}
	var payload struct {
		Refs []db.TrafficRef `json:"traffic_refs"`
	}
	if err := json.Unmarshal(n.Payload, &payload); err != nil {
		return nil, err
	}
	return db.NormalizeTrafficRefs(append(append([]db.TrafficRef{}, explicit...), payload.Refs...))
}
