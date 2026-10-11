"use client";

import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const termsBodyRef = useRef<HTMLDivElement>(null);

  // 滚动到条款底部（含无需滚动即可完整展示的情况）方可点击「同意」。
  function handleTermsScroll() {
    const el = termsBodyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadToEnd(true);
  }

  useEffect(() => {
    if (!termsOpen) return;
    // 打开时重置，并处理内容本就不足一屏、无法触发滚动的场景。
    setReadToEnd(false);
    const el = termsBodyRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setReadToEnd(true);
  }, [termsOpen]);

  useEffect(() => {
    // 已登录直接进主界面（静态导出下无 middleware 代劳这层跳转）。
    const token = auth.getToken();
    if (token) {
      // localStorage 可能仍有凭据但 cookie 已丢失。先同步，再发起全新请求，
      // 避免Service端守卫或路由缓存把跳转送回仍处于 checking 状态的登录页。
      auth.setToken(token);
      window.location.replace("/function/tasks");
      return;
    }
    api
      .authStatus()
      .then(({ initialized }) => {
        if (!initialized) router.replace("/setup");
      })
      .catch(() => setError("Unable to connect to backend service"))
      .finally(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) {
      setError("Please read and agree to the Terms of Use first");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { token } = await api.login("ARTEX", password);
      auth.setToken(token);
      window.location.replace("/function/tasks");
    } catch {
      setError("Incorrect username or password");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div role="status" className="flex min-h-dvh items-center justify-center text-muted-foreground">
        Checking login status…
      </div>
    );
  }

  return (
    <div className="flex h-dvh">
      {/* Left panel */}
      <div className="hidden flex-col items-center justify-center bg-primary p-12 text-center lg:flex lg:w-1/3">
        <div className="relative flex items-center justify-center">
          <div className="absolute size-80 rounded-full border border-primary-foreground/10" />
          <div className="absolute size-60 rounded-full border border-primary-foreground/15" />
          <div className="absolute size-40 rounded-full border border-primary-foreground/20" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="ARTEX" width={160} height={160} className="relative brightness-0 invert" />
        </div>
      </div>

      {/* Right panel */}
      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-10 py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <h2 className="font-medium text-2xl tracking-tight">Login</h2>
            <p className="mx-auto max-w-xl text-muted-foreground">
              Welcome back, enter your password to continue using ARTEX
            </p>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value="ARTEX" readOnly className="bg-muted text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="agree-terms"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="agree-terms" className="font-normal text-muted-foreground text-sm leading-relaxed">
                I have read and agree to the
                <button
                  type="button"
                  onClick={() => setTermsOpen(true)}
                  className="mx-0.5 font-medium text-primary underline-offset-4 hover:underline"
                >
                  Terms of Use
                </button>
              </Label>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !password || !agreed}>
              {loading ? "Logging in..." : "Login"}
            </Button>
          </form>
        </div>
      </div>

      <Dialog open={termsOpen} onOpenChange={setTermsOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="flex-row items-center gap-3 border-b px-6 py-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div className="space-y-0.5">
              <DialogTitle className="text-base">ARTEX Terms of Use & Disclaimer</DialogTitle>
              <p className="text-muted-foreground text-xs">
                Version 1.0 · Effective date: 2026-09-18 · Read all terms below before logging in
              </p>
            </div>
          </DialogHeader>

          <div
            ref={termsBodyRef}
            onScroll={handleTermsScroll}
            className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5 text-muted-foreground text-sm leading-relaxed"
          >
            <p className="rounded-lg border bg-muted/40 p-3 text-foreground/80">
              This Use Notice and Disclaimer (the “Notice”) is an agreement between you and the ARTEX authors and
              contributors governing your use of this software. Please read and understand all terms carefully before
              using it, especially the disclaimers, liability limits, and prohibited-use provisions highlighted in bold
              or colored blocks.
              <span className="font-medium text-foreground">
                {" "}
                By downloading, installing, accessing, or otherwise using this software, you acknowledge that you have
                read, understood, and agreed to be bound by this Notice.
              </span>
            </p>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs">
                  1
                </span>
                Article 1 · Definitions and Open-Source License
              </h4>
              <p className="pl-7">
                ARTEX is open-source software released under the GNU Affero General Public License v3.0 (AGPL-3.0). You
                may use, copy, modify, and distribute it under that license; however, derivative works, including online
                services provided to third parties over a network, must also be released under AGPL-3.0 with the
                complete corresponding source code made available to users. The accompanying LICENSE file governs the
                complete AGPL-3.0 terms.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs">
                  2
                </span>
                Article 2 · Permitted Use
              </h4>
              <p className="pl-7">
                This software is intended only for personal learning, code research, security education, and technical
                validation in a local isolated environment that you operate. It is suitable for non-adversarial,
                non-destructive purposes such as study, academic research, and code review. You may not use it for any
                other purpose unless expressly permitted by this article.
              </p>
            </section>

            <section className="space-y-2">
              <h4 className="flex items-center gap-2 font-medium text-destructive">
                <span className="flex size-5 items-center justify-center rounded-md bg-destructive/10 font-semibold text-destructive text-xs">
                  3
                </span>
                <AlertTriangle className="size-4" />
                Article 3 · Prohibited Conduct
              </h4>
              <ul className="ml-7 list-decimal space-y-1.5 rounded-lg border border-destructive/20 bg-destructive/5 p-3 pl-8 text-foreground/80 marker:text-destructive/70">
                <li>
                  Never scan, probe, exploit, or attack any website, online service, or networked system owned by
                  another person or third party, regardless of authorization or ownership;
                </li>
                <li>
                  Never use this software for real penetration tests, adversarial exercises, red-team or blue-team
                  drills, or production environments;
                </li>
                <li>
                  Never use this software for unauthorized intrusion, data theft, extortion, denial-of-service
                  (DoS/DDoS), or any destructive or criminal activity;
                </li>
                <li>
                  Never remove, alter, or circumvent copyright, license, or security notices in this software or its
                  output;
                </li>
                <li>
                  Never engage in conduct that violates the laws, regulations, or regulatory requirements of your
                  country or region.
                </li>
              </ul>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs">
                  4
                </span>
                Article 4 · Intellectual Property
              </h4>
              <p className="pl-7">
                Copyright and related intellectual property rights in this software belong to the project authors and
                contributors. Rights are granted to you only within the scope of AGPL-3.0. Except for rights expressly
                granted by that license, this Notice grants no other rights, expressly or by implication.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs">
                  5
                </span>
                Article 5 · Data and Privacy
              </h4>
              <p className="pl-7">
                This is self-hosted open-source software. The authors do not operate a centralized service and do not
                collect or upload your usage data. You control all data you generate, process, or access while using the
                software and are responsible for its legality and security; you bear all consequences of improper data
                handling.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs">
                  6
                </span>
                Article 6 · Compliance and Legal Responsibility
              </h4>
              <p className="pl-7">
                You must comply with all laws and regulations in your country or region concerning cybersecurity, data
                security, personal information protection, computer crime, and related matters.
                <span className="font-medium text-foreground">
                  {" "}
                  You alone are responsible for all legal liability and consequences arising from your violation of
                  those laws or this Notice; they do not attach to the authors or contributors of this software.
                </span>
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs">
                  7
                </span>
                Article 7 · Disclaimer and Limitation of Liability
              </h4>
              <p className="pl-7">
                This software is provided “AS IS” and “AS AVAILABLE,” without warranties of any kind, express or
                implied, including warranties of merchantability, fitness for a particular purpose, accuracy, or
                non-infringement. To the fullest extent permitted by applicable law, the authors and contributors are
                not liable for any direct, indirect, incidental, special, or consequential loss arising from or related
                to your use or inability to use this software, including data loss, system damage, business
                interruption, lost profits, or legal disputes.
              </p>
            </section>

            <section className="space-y-1.5">
              <h4 className="flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-5 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground text-xs">
                  8
                </span>
                Article 8 · Changes and Final Interpretation
              </h4>
              <p className="pl-7">
                The authors may update this Notice from time to time as required by law or project development. Each
                updated version takes effect when published with the project; continued use of the software constitutes
                acceptance of the revised terms. To the extent permitted by law, the authors retain final interpretive
                authority over this Notice. If any provision is held invalid, the remaining provisions remain in effect.
              </p>
            </section>
          </div>

          <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-2 rounded-b-xl px-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              {readToEnd ? "You have read all terms" : "Scroll to the bottom of the terms before confirming"}
            </p>
            <DialogClose asChild>
              <Button
                type="button"
                disabled={!readToEnd}
                onClick={() => {
                  setAgreed(true);
                  setError("");
                }}
              >
                I have read and agree to all terms
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
