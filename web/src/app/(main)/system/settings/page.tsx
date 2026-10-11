"use client";

import * as React from "react";

import { CpuIcon, FlaskConicalIcon, KeyboardIcon, RadioTowerIcon, SearchIcon, ShieldAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { CHAT_SEND_MODE_OPTIONS, type ChatSendMode, setChatSendMode, useChatSendMode } from "@/lib/chat-send-mode";
import type { Settings } from "@/lib/types";

import { UpdateCard } from "./_components/update-card";

export default function SystemSettingsPage() {
  const [trafficCapture, setTrafficCapture] = React.useState(false);
  const [agentTrafficBinding, setAgentTrafficBinding] = React.useState(false);
  const [webSearch, setWebSearch] = React.useState(false);
  const [backend, setBackend] = React.useState("ddgs");
  const [braveKeySet, setBraveKeySet] = React.useState(false);
  const [braveKeyInput, setBraveKeyInput] = React.useState("");
  const [tavilyKeySet, setTavilyKeySet] = React.useState(false);
  const [tavilyKeyInput, setTavilyKeyInput] = React.useState("");
  const [savingTavilyKey, setSavingTavilyKey] = React.useState(false);
  const [proxyInput, setProxyInput] = React.useState("");
  const [savingProxy, setSavingProxy] = React.useState(false);
  const [globalProxyInput, setGlobalProxyInput] = React.useState("");
  const [savingGlobalProxy, setSavingGlobalProxy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState(false);
  const [pyInterp, setPyInterp] = React.useState("");
  const [workers, setWorkers] = React.useState("3");
  const [savingWorkers, setSavingWorkers] = React.useState(false);
  // Operation constraint injection scopes (enabled by default).
  const [injectPlanner, setInjectPlanner] = React.useState(true);
  const [injectWorker, setInjectWorker] = React.useState(true);
  // Experimental feature: noa context compaction (disabled by default).
  const [noaCompaction, setNoaCompaction] = React.useState(false);
  // Frontend-only preference: read and write localStorage directly instead of /api/settings.
  const sendMode = useChatSendMode();

  const apply = React.useCallback((s: Settings) => {
    setTrafficCapture(!!s.traffic_capture);
    setAgentTrafficBinding(!!s.agent_traffic_binding);
    setWebSearch(!!s.web_search_enabled);
    setBackend(s.web_search_backend || "ddgs");
    setBraveKeySet(!!s.brave_key_set);
    setTavilyKeySet(!!s.tavily_key_set);
    setProxyInput(s.web_search_proxy ?? "");
    setGlobalProxyInput(s.global_proxy ?? "");
    setPyInterp(s.python_interpreter ?? "");
    setWorkers(String(s.workers ?? 3));
    setInjectPlanner(s.constraints_inject_planner !== false);
    setInjectWorker(s.constraints_inject_worker !== false);
    setNoaCompaction(!!s.noa_compaction);
  }, []);

  const saveWorkers = () => {
    const n = Number(workers);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error("Worker count must be a positive integer");
      return;
    }
    setSavingWorkers(true);
    api
      .setSettings({ workers: n })
      .then((s) => {
        apply(s);
        toast.success("Worker count saved (applies to tasks started next)");
      })
      .catch((e) => toast.error(`Save failed: ${(e as Error).message}`))
      .finally(() => setSavingWorkers(false));
  };

  const savePython = () => {
    setSaving(true);
    api
      .setSettings({ python_interpreter: pyInterp.trim() })
      .then((s) => {
        apply(s);
        toast.success("Python interpreter settings saved");
      })
      .catch((e) => toast.error(`Save failed: ${(e as Error).message}`))
      .finally(() => setSaving(false));
  };
  const detectPython = () => {
    setSaving(true);
    api
      .detectPython()
      .then((r) => setPyInterp(r.python_interpreter))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  React.useEffect(() => {
    api
      .settings()
      .then(apply)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [apply]);

  const toggleTraffic = (v: boolean) => {
    setTrafficCapture(v); // optimistic
    setSaving(true);
    api
      .setSettings({ traffic_capture: v })
      .then(apply)
      .catch(() => setTrafficCapture(!v)) // revert on failure
      .finally(() => setSaving(false));
  };

  const toggleInjectPlanner = (v: boolean) => {
    setInjectPlanner(v); // optimistic
    api
      .setSettings({ constraints_inject_planner: v })
      .then(apply)
      .catch(() => setInjectPlanner(!v)); // revert on failure
  };

  const toggleAgentTrafficBinding = (v: boolean) => {
    setAgentTrafficBinding(v);
    setSaving(true);
    api
      .setSettings({ agent_traffic_binding: v })
      .then((s) => {
        apply(s);
        toast.success(v ? "Automatic Agent traffic binding enabled" : "Automatic Agent traffic binding disabled");
      })
      .catch((e) => {
        setAgentTrafficBinding(!v);
        toast.error(`Save failed: ${(e as Error).message}`);
      })
      .finally(() => setSaving(false));
  };

  const toggleInjectWorker = (v: boolean) => {
    setInjectWorker(v); // optimistic
    api
      .setSettings({ constraints_inject_worker: v })
      .then(apply)
      .catch(() => setInjectWorker(!v)); // revert on failure
  };

  const toggleNoaCompaction = (v: boolean) => {
    setNoaCompaction(v); // optimistic
    api
      .setSettings({ noa_compaction: v })
      .then((s) => {
        apply(s);
        toast.success(v ? "noa context compaction enabled (applies to runs started next)" : "noa context compaction disabled (restored built-in compaction)");
      })
      .catch((e) => {
        setNoaCompaction(!v); // revert on failure
        toast.error(`Save failed: ${(e as Error).message}`);
      });
  };

  // Persist a web-search patch (enable and/or backend). Optimistic with refetch.
  const saveWebSearch = (patch: Partial<Settings>) => {
    setSaving(true);
    api
      .setSettings(patch)
      .then((s) => {
        apply(s);
        toast.success("Web search settings saved");
      })
      .catch((e) => {
        toast.error(`Save failed: ${(e as Error).message}`);
        api
          .settings()
          .then(apply)
          .catch(() => undefined);
      })
      .finally(() => setSaving(false));
  };

  const saveBraveKey = () => {
    setSavingKey(true);
    api
      .setSettings({ brave_search_api_key: braveKeyInput })
      .then((s) => {
        apply(s);
        setBraveKeyInput("");
        toast.success("Brave API key saved");
      })
      .catch((e) => toast.error(`Save failed: ${(e as Error).message}`))
      .finally(() => setSavingKey(false));
  };

  const saveTavilyKey = () => {
    setSavingTavilyKey(true);
    api
      .setSettings({ tavily_search_api_key: tavilyKeyInput })
      .then((s) => {
        apply(s);
        setTavilyKeyInput("");
        toast.success("Tavily API key saved");
      })
      .catch((e) => toast.error(`Save failed: ${(e as Error).message}`))
      .finally(() => setSavingTavilyKey(false));
  };

  const saveProxy = () => {
    setSavingProxy(true);
    api
      .setSettings({ web_search_proxy: proxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(proxyInput.trim() ? "Egress proxy saved" : "Egress proxy cleared (using a direct connection)");
      })
      .catch((e) => toast.error(`Save failed: ${(e as Error).message}`))
      .finally(() => setSavingProxy(false));
  };

  const saveGlobalProxy = () => {
    setSavingGlobalProxy(true);
    api
      .setSettings({ global_proxy: globalProxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(globalProxyInput.trim() ? "Global proxy saved" : "Global proxy cleared (using a direct connection)");
      })
      .catch((e) => toast.error(`Save failed: ${(e as Error).message}`))
      .finally(() => setSavingGlobalProxy(false));
  };

  // Run a real "test" search ("test") against the CURRENT form values (backend +
  // proxy + entered key), falling back to saved values server-side. Toasts result.
  const runTest = () => {
    setTesting(true);
    api
      .testWebSearch({
        web_search_backend: backend,
        web_search_proxy: proxyInput.trim(),
        brave_search_api_key: braveKeyInput,
        tavily_search_api_key: tavilyKeyInput,
      })
      .then((r) => {
        if (r.ok) toast.success(`Search test succeeded · ${r.backend} returned ${r.count} results`);
        else toast.error(`Search test failed: ${r.error || "Unknown error"}`);
      })
      .catch((e) => toast.error(`Search test failed: ${(e as Error).message}`))
      .finally(() => setTesting(false));
  };

  // brave-free selected but no key stored and none being entered → tool stays off.
  const braveNeedsKey = webSearch && backend === "brave-free" && !braveKeySet;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div>
        <h1 className="font-semibold text-xl tracking-tight">System Settings</h1>
        <p className="text-muted-foreground text-sm">Global runtime controls</p>
      </div>

      {/* Use columns instead of a grid: the Web Search card is much taller and changes with the selected backend (brave/tavily
          key inputs are conditional). A grid would stretch every card to the tallest item and leave large empty areas;
          columns balance cards by content height. Use mb instead of gap because column-gap controls only column spacing. */}
      <div className="columns-1 gap-4 md:gap-6 lg:columns-2">
        <UpdateCard />

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              Traffic Capture
            </CardTitle>
            <CardDescription>
              When enabled, all Agent HTTP traffic is stored through the recording proxy, and traffic_search / traffic_get
              tools and proxy settings are injected into Agents (including proxy guidance in prompts).
              <br />
              When disabled (the default), no traffic is recorded: Agents
              <b>do not</b> receive proxy settings or traffic tools, and prompts <b>do not include</b> proxy content. Changes rebuild Agents immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="traffic-capture" className="font-normal text-muted-foreground text-sm">
              {trafficCapture ? "Enabled · recording traffic and injecting proxy settings" : "Disabled · no recording or proxy injection"}
            </Label>
            <Switch
              id="traffic-capture"
              checked={trafficCapture}
              disabled={!loaded || saving}
              onCheckedChange={toggleTraffic}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              Automatic Agent Traffic Binding
            </CardTitle>
            <CardDescription id="agent-traffic-binding-description">
              Disabled by default. When enabled, the reporting Agent triggered by a new finding checks existing HTTP requests/responses,
              links matching traffic, and then writes the report. <b>Reviewing packets and making extra tool calls increases token usage.</b>
              <br />
              Reporting still works for TCP findings, uncaptured traffic, or traffic without a match. This does not affect Traffic Capture,
              manual binding, or viewing saved evidence. It applies to the next Agent run; disabling immediately rejects new automatic bindings.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="agent-traffic-binding" className="font-normal text-muted-foreground text-sm">
              {agentTrafficBinding ? "Enabled · increases token usage" : "Disabled · manual binding remains available"}
            </Label>
            <Switch
              id="agent-traffic-binding"
              aria-describedby="agent-traffic-binding-description"
              checked={agentTrafficBinding}
              disabled={!loaded || saving}
              onCheckedChange={toggleAgentTrafficBinding}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              Global Proxy
            </CardTitle>
            <CardDescription>
              All Agent <b>target traffic</b> exits through this proxy (hide the source IP / use a jump host). Supports <b>http / https / socks5</b>
              with optional <code>user:pass</code> authentication. Leave blank for a direct connection.
              <br />
              With <b>Traffic Capture</b> enabled, this is the recording proxy's <b>upstream</b>
              (traffic is still stored and then sent through this proxy); with capture disabled, it is injected directly into Agent bash / WebFetch
              traffic. It is independent of the Web Search and LLM proxies.
              <br />
              <b>Note</b>: socks5 with capture <b>disabled</b> depends on each command-line tool supporting <code>ALL_PROXY</code> (curl
              does; some tools may ignore it). If socks5 is your main use case, enable Traffic Capture—the MITM path dials directly
              and works reliably without tool awareness.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="global-proxy" className="font-normal text-muted-foreground text-sm">
              Proxy address
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="global-proxy"
                autoComplete="off"
                placeholder="socks5://user:pass@host:1080 or http://host:port (blank = direct connection)"
                value={globalProxyInput}
                disabled={!loaded || savingGlobalProxy}
                onChange={(e) => setGlobalProxyInput(e.target.value)}
              />
              <Button type="button" onClick={saveGlobalProxy} disabled={!loaded || savingGlobalProxy}>
                Save
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {globalProxyInput.trim() ? "Configured · all target traffic uses this proxy" : "Not configured · target traffic uses a direct connection"}
            </p>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlertIcon className="size-4" />
              Operation Constraint Injection
            </CardTitle>
            <CardDescription>
              When enabled, each task's <b>operation constraints</b> (the allow/deny entries maintained under "Operation Constraints" in the task overview)
              are added to the corresponding Agent's system prompt to define exploration boundaries (for example, "test only the current port" or "no brute force").
              <br />
              Control injection separately for the <b>planner</b> and <b>worker</b>; both are enabled by default. Changes apply on the next read without rebuilding Agents.
              When disabled, the Agent no longer sees these constraints.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-planner" className="font-normal text-muted-foreground text-sm">
                Inject into planner{injectPlanner ? " · Enabled" : " · Disabled"}
              </Label>
              <Switch
                id="inject-planner"
                checked={injectPlanner}
                disabled={!loaded}
                onCheckedChange={toggleInjectPlanner}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-worker" className="font-normal text-muted-foreground text-sm">
                Inject into worker{injectWorker ? " · Enabled" : " · Disabled"}
              </Label>
              <Switch
                id="inject-worker"
                checked={injectWorker}
                disabled={!loaded}
                onCheckedChange={toggleInjectWorker}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConicalIcon className="size-4" />
              Experimental Features
            </CardTitle>
            <CardDescription>
              These mechanisms are still being validated and are disabled by default. They may change Agent behavior or affect stability; enable them only after reviewing the impact.
              <br />
              <b>noa context compaction</b>: the model actively compacts long conversation history (norma v0.4.0). When enabled, the four Agent types used by the platform
              (<b>planner / worker / main Agent / chat</b>) use noa instead of built-in compaction, and archive the original text in the task working directory for review.
              Changes apply immediately to runs started next without rebuilding Agents; disabling restores built-in compaction.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="noa-compaction" className="font-normal text-muted-foreground text-sm">
              noa context compaction{noaCompaction ? " · Enabled" : " · Disabled"}
            </Label>
            <Switch
              id="noa-compaction"
              checked={noaCompaction}
              disabled={!loaded}
              onCheckedChange={toggleNoaCompaction}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SearchIcon className="size-4" />
              Web Search
            </CardTitle>
            <CardDescription>
              This is the <b>global Web Search switch and source configuration</b>. When enabled, each <b>Agent configuration</b> can independently enable
              <b>web_search</b> (returns only titles, links, and snippets; WebFetch retrieves full content). Web Search <b>does not use</b>
              the recording proxy and is independent of Traffic Capture.
              <br />
              Sources include <b>DuckDuckGo (ddgs)</b> (no key required), <b>Brave (free tier)</b> (requires a Brave API key),{" "}
              <b>Tavily</b> (requires a Tavily API key), or <b>DeepSeek</b> (reuses the current LLM configuration). When the global switch is disabled, Agents
              cannot enable Web Search.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="web-search" className="font-normal text-muted-foreground text-sm">
                {webSearch ? "Global switch enabled · configure per Agent" : "Disabled · Agents cannot use Web Search"}
              </Label>
              <Switch
                id="web-search"
                checked={webSearch}
                disabled={!loaded || saving}
                onCheckedChange={(v) => {
                  setWebSearch(v); // optimistic
                  saveWebSearch({ web_search_enabled: v });
                }}
              />
            </div>

            {webSearch && (
              <div className="flex items-center justify-between gap-4">
                <Label className="font-normal text-muted-foreground text-sm">Search source</Label>
                <Select
                  value={backend}
                  disabled={!loaded || saving}
                  onValueChange={(v) => {
                    setBackend(v); // optimistic
                    saveWebSearch({ web_search_backend: v });
                  }}
                >
                  <SelectTrigger className="w-48 shrink-0">
                    <SelectValue placeholder="Select a source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ddgs">DuckDuckGo (ddgs · free, no key)</SelectItem>
                    <SelectItem value="brave-free">Brave (free tier · key required)</SelectItem>
                    <SelectItem value="tavily">Tavily (key required)</SelectItem>
                    <SelectItem value="deepseek">DeepSeek (official)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {webSearch && backend === "deepseek" && (
              <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
                <p className="font-medium text-sm">DeepSeek official web search</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  This source directly reuses the <b>currently active LLM configuration</b>. It therefore
                  <b>supports only official DeepSeek models</b>, and the configuration <b>must use the Anthropic protocol</b>.
                  DeepSeek's OpenAI-protocol endpoint does not support server-side search. This source may stop working after switching the LLM configuration.
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Unlike other sources, search is executed by the <b>DeepSeek service</b>: each search consumes an additional model call (and incurs token
                  costs). Search requests <b>do not use the egress proxy</b> and are <b>not recorded as traffic</b>; results contain <b>only titles and links</b>
                  (no snippets), while WebFetch retrieves full content when needed.
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Confirm these requirements yourself; the system does not block the configuration. Use the "Test Search" button below to verify it.
                </p>
              </div>
            )}

            {webSearch && backend === "brave-free" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="brave-key" className="font-normal text-muted-foreground text-sm">
                  Brave Search API Key
                  {braveKeySet && <span className="ml-2 text-emerald-500 text-xs">Configured</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="brave-key"
                    type="password"
                    autoComplete="off"
                    placeholder={braveKeySet ? "Configured (leave blank to keep)" : "Enter Brave API key"}
                    value={braveKeyInput}
                    disabled={!loaded || savingKey}
                    onChange={(e) => setBraveKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveBraveKey}
                    disabled={!loaded || savingKey || braveKeyInput.trim() === ""}
                  >
                    Save
                  </Button>
                </div>
                {braveNeedsKey && (
                  <p className="text-amber-500 text-xs">
                    Brave is selected but no key is configured; the search tool stays disabled until you save a key.
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  The free tier provides about 2,000 requests per month. Get a key at https://brave.com/search/api/.
                </p>
              </div>
            )}

            {webSearch && backend === "tavily" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="tavily-key" className="font-normal text-muted-foreground text-sm">
                  Tavily Search API Key
                  {tavilyKeySet && <span className="ml-2 text-emerald-500 text-xs">Configured</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tavily-key"
                    type="password"
                    autoComplete="off"
                    placeholder={tavilyKeySet ? "Configured (leave blank to keep)" : "Enter Tavily API key (tvly-…)"}
                    value={tavilyKeyInput}
                    disabled={!loaded || savingTavilyKey}
                    onChange={(e) => setTavilyKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveTavilyKey}
                    disabled={!loaded || savingTavilyKey || tavilyKeyInput.trim() === ""}
                  >
                    Save
                  </Button>
                </div>
                {webSearch && backend === "tavily" && !tavilyKeySet && (
                  <p className="text-amber-500 text-xs">
                    Tavily is selected but no key is configured; the search tool stays disabled until you save a key.
                  </p>
                )}
                <p className="text-muted-foreground text-xs">Register and get an API key at https://tavily.com/.</p>
              </div>
            )}

            {webSearch && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-proxy" className="font-normal text-muted-foreground text-sm">
                  Egress proxy (optional)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ws-proxy"
                    autoComplete="off"
                    placeholder="http://host:port or socks5://host:port (blank = direct connection)"
                    value={proxyInput}
                    disabled={!loaded || savingProxy}
                    onChange={(e) => setProxyInput(e.target.value)}
                  />
                  <Button type="button" onClick={saveProxy} disabled={!loaded || savingProxy}>
                    Save
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  An independent egress proxy used only to access the search endpoint (VPN/SOCKS, and so on). It is separate from the traffic-recording MITM
                  proxy; search requests use it when a direct connection is unavailable.
                </p>
              </div>
            )}

            {webSearch && (
              <div className="flex items-center justify-between gap-4 border-t pt-4">
                <p className="text-muted-foreground text-xs">
                  Run one "test" search with the current source, proxy, and key to verify that it works.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runTest}
                  disabled={!loaded || testing}
                  className="shrink-0"
                >
                  {testing ? "Testing…" : "Test Search"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              Custom Scripts · Python Interpreter
            </CardTitle>
            <CardDescription>
              Custom <b>script</b> tools use this interpreter to run Python. It is detected at startup (python3 preferred); you can enter an absolute path to a venv /
              specific version here, or leave it blank for runtime auto-detection.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                className="font-mono text-sm"
                placeholder="/usr/bin/python3 (blank = auto-detect)"
                value={pyInterp}
                disabled={!loaded || saving}
                onChange={(e) => setPyInterp(e.target.value)}
              />
              <Button variant="outline" onClick={detectPython} disabled={!loaded || saving}>
                Detect Again
              </Button>
              <Button onClick={savePython} disabled={!loaded || saving}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CpuIcon className="size-4" />
              Work Concurrency · Work Agent Count
            </CardTitle>
            <CardDescription>
              Number of work agents running concurrently per task (default: 3). Higher values run more probes in parallel and consume more resources.
              Changes <b>apply to tasks started next</b>; running tasks are not affected.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                className="w-32 font-mono text-sm"
                placeholder="3"
                value={workers}
                disabled={!loaded || savingWorkers}
                onChange={(e) => setWorkers(e.target.value)}
              />
              <Button onClick={saveWorkers} disabled={!loaded || savingWorkers}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyboardIcon className="size-4" />
              Chat Input Send Key
            </CardTitle>
            <CardDescription>
              The chat page and task-detail main Agent input share this setting. Changes apply immediately; no save is required.
              <br />
              This preference <b>exists only in this browser</b>; it is not synced with your account and must be set again in another browser or after clearing site data.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="chat-send-mode" className="font-normal text-muted-foreground text-sm">
              Send mode
            </Label>
            <Select value={sendMode} onValueChange={(v) => setChatSendMode(v as ChatSendMode)}>
              <SelectTrigger id="chat-send-mode" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_SEND_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
