"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CloudOff, Flag, List, Loader2, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { QuestionCard } from "@/components/question-card";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/vi";
import { remainingMs } from "@/lib/grading/deadline";
import type { ExamPaper } from "@/server/exam";
import { saveAnswerAction, submitAttemptAction } from "@/app/(app)/attempts/actions";

type SaveState = "saved" | "saving" | "offline";

const storageKey = (id: string) => `exam:${id}:pending`;
const flagKey = (id: string) => `exam:${id}:flags`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the server copy is authoritative anyway */
  }
}

function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ExamClient({ attempt, paper, answers: initialAnswers, serverNow }: ExamPaper) {
  const router = useRouter();
  const deadline = useMemo(() => new Date(attempt.deadline_at), [attempt.deadline_at]);
  const resultPath = `/attempts/${attempt.id}/result`;

  const [answers, setAnswers] = useState<Record<string, string[]>>(initialAnswers);
  const [flags, setFlags] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  /** Client clock reading + measured server offset; set by the ticker (null before hydration). */
  const [clock, setClock] = useState<{ now: number; offset: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [finishing, setFinishing] = useState<null | "manual" | "timeout">(null);

  const pendingRef = useRef(new Map<string, string[]>());
  const flushingRef = useRef<Promise<void> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(2000);
  const closedRef = useRef(false);
  const finishingRef = useRef(false);
  const announcedRef = useRef({ five: false, one: false });
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const finishRef = useRef<(reason: "manual" | "timeout") => Promise<void>>(async () => {});

  const persistPending = useCallback(() => {
    writeJson(storageKey(attempt.id), Object.fromEntries(pendingRef.current));
  }, [attempt.id]);

  /** Sends queued answers one by one; on network failure keeps the queue and retries with backoff. */
  const flush = useCallback((): Promise<void> => {
    if (flushingRef.current) return flushingRef.current;
    const run = (async () => {
      while (pendingRef.current.size > 0 && !closedRef.current) {
        const [questionId, labels] = pendingRef.current.entries().next().value as [string, string[]];
        setSaveState("saving");
        let res: Awaited<ReturnType<typeof saveAnswerAction>>;
        try {
          res = await saveAnswerAction(attempt.id, questionId, labels);
        } catch {
          setSaveState("offline");
          if (retryRef.current) clearTimeout(retryRef.current);
          retryRef.current = setTimeout(() => void flushRef.current(), backoffRef.current);
          backoffRef.current = Math.min(backoffRef.current * 2, 15000);
          return;
        }
        backoffRef.current = 2000;
        if (pendingRef.current.get(questionId) === labels) pendingRef.current.delete(questionId);
        persistPending();
        if (!res.ok) {
          if (res.code === "ATTEMPT_CLOSED" || res.code === "DEADLINE_PASSED") {
            closedRef.current = true;
            toast.error(res.message);
            router.replace(resultPath);
            return;
          }
          toast.error(res.message);
        }
      }
      setSaveState("saved");
    })().finally(() => {
      flushingRef.current = null;
    });
    flushingRef.current = run;
    return run;
  }, [attempt.id, persistPending, resultPath, router]);

  const finish = useCallback(
    async (reason: "manual" | "timeout") => {
      if (closedRef.current || finishingRef.current) return;
      finishingRef.current = true;
      setFinishing(reason);
      await flush();
      const abort = () => {
        finishingRef.current = false;
        setFinishing(null);
        toast.error(t.exam.offline);
      };
      // Still offline: don't submit manually without the latest answers.
      if (pendingRef.current.size > 0 && reason === "manual") return abort();
      try {
        const res = await submitAttemptAction(attempt.id, reason);
        if (!res.ok && res.code !== "ATTEMPT_CLOSED") throw new Error(res.message);
      } catch {
        if (reason === "manual") return abort();
        // On timeout the server finalizes the attempt itself on the next access.
      }
      closedRef.current = true;
      try {
        localStorage.removeItem(storageKey(attempt.id));
      } catch {}
      router.replace(resultPath);
    },
    [attempt.id, flush, resultPath, router],
  );

  useEffect(() => {
    flushRef.current = flush;
    finishRef.current = finish;
  }, [flush, finish]);

  // Mount: measure the clock offset, restore unsent answers/flags from browser storage,
  // and run a ticker that drives the countdown, warnings and auto-submit.
  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();

    const init = setTimeout(() => {
      const restored = readJson<Record<string, string[]>>(storageKey(attempt.id), {});
      for (const [qid, labels] of Object.entries(restored)) pendingRef.current.set(qid, labels);
      if (Object.keys(restored).length) setAnswers((a) => ({ ...a, ...restored }));
      setFlags(readJson<string[]>(flagKey(attempt.id), []));
      void flushRef.current();
    }, 0);

    const tick = () => {
      const now = Date.now();
      setClock({ now, offset });
      if (finishingRef.current || closedRef.current) return;
      const left = remainingMs(deadline, now, offset);
      if (left <= 0) {
        void finishRef.current("timeout");
      } else if (left <= 60_000 && !announcedRef.current.one) {
        announcedRef.current.one = announcedRef.current.five = true;
        toast.warning(t.exam.oneMinute);
      } else if (left <= 300_000 && !announcedRef.current.five) {
        announcedRef.current.five = true;
        toast.warning(t.exam.fiveMinutes);
      }
    };
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 500);

    const online = () => void flushRef.current();
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0) e.preventDefault();
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearTimeout(init);
      clearTimeout(first);
      clearInterval(interval);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [attempt.id, serverNow, deadline]);

  const remaining = clock === null ? null : remainingMs(deadline, clock.now, clock.offset);

  function change(questionId: string, labels: string[]) {
    if (closedRef.current || finishing) return;
    setAnswers((a) => ({ ...a, [questionId]: labels }));
    pendingRef.current.set(questionId, labels);
    persistPending();
    setSaveState("saving");
    void flush();
  }

  function toggleFlag(questionId: string) {
    setFlags((f) => {
      const next = f.includes(questionId) ? f.filter((x) => x !== questionId) : [...f, questionId];
      writeJson(flagKey(attempt.id), next);
      return next;
    });
  }

  const questions = paper.questions;
  const answeredCount = questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length;
  const unanswered = questions.filter((q) => !(answers[q.id]?.length));

  const timerCls =
    remaining === null || remaining > 300_000
      ? ""
      : remaining > 60_000
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const saveIndicator = (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      {saveState === "saved" && (
        <>
          <CircleCheck className="size-3.5 text-green-600" /> {t.exam.saved}
        </>
      )}
      {saveState === "saving" && (
        <>
          <Loader2 className="size-3.5 animate-spin" /> {t.exam.saving}
        </>
      )}
      {saveState === "offline" && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <CloudOff className="size-3.5" /> {t.exam.offline}
        </span>
      )}
    </span>
  );

  const timer = (
    <span className={cn("inline-flex items-center gap-1 font-mono text-lg font-semibold tabular-nums", timerCls)} aria-label={t.exam.remaining}>
      <Timer className="size-5" aria-hidden />
      {remaining === null ? "--:--" : formatClock(remaining)}
    </span>
  );

  const navGrid = (onPick?: () => void) => (
    <div className="grid gap-3">
      <div className="grid grid-cols-6 gap-1.5" role="list" aria-label={t.exam.questionList}>
        {questions.map((q) => {
          const done = (answers[q.id]?.length ?? 0) > 0;
          const flagged = flags.includes(q.id);
          return (
            <button
              key={q.id}
              type="button"
              role="listitem"
              onClick={() => {
                document.getElementById(`question-${q.position}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                onPick?.();
              }}
              aria-label={`${t.question.number(q.position)}${done ? ` (${t.exam.legendDone})` : ""}${flagged ? ` (${t.exam.legendFlag})` : ""}`}
              className={cn(
                "relative h-10 rounded-md border text-sm tabular-nums transition-colors",
                done ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {q.position}
              {flagged && <Flag className="absolute -top-1 -right-1 size-3.5 fill-amber-500 text-amber-500" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm bg-primary" /> {t.exam.legendDone}</span>
        <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm border" /> {t.exam.legendTodo}</span>
        <span className="inline-flex items-center gap-1"><Flag className="size-3 fill-amber-500 text-amber-500" /> {t.exam.legendFlag}</span>
      </p>
    </div>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
        {timer}
        <span className="text-sm text-muted-foreground tabular-nums">
          {answeredCount}/{questions.length}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="lg" onClick={() => setNavOpen(true)} aria-label={t.exam.questionList}>
            <List />
          </Button>
          <Button size="lg" onClick={() => setConfirmOpen(true)} disabled={!!finishing}>
            {t.exam.submit}
          </Button>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_300px]">
        <main className="grid content-start gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">{paper.title}</h1>
            {saveIndicator}
          </div>
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              mode="exam"
              selected={answers[q.id] ?? []}
              onChange={(labels) => change(q.id, labels)}
              disabled={!!finishing}
              headerExtra={
                <button
                  type="button"
                  onClick={() => toggleFlag(q.id)}
                  aria-pressed={flags.includes(q.id)}
                  aria-label={flags.includes(q.id) ? t.exam.unflag : t.exam.flag}
                  className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <Flag className={cn("size-4", flags.includes(q.id) && "fill-amber-500 text-amber-500")} />
                </button>
              }
            />
          ))}
        </main>

        {/* Desktop side panel */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 grid gap-4 rounded-xl border p-4">
            {timer}
            <p className="text-sm text-muted-foreground">{t.exam.progress(answeredCount, questions.length)}</p>
            {navGrid()}
            <Button className="h-11" onClick={() => setConfirmOpen(true)} disabled={!!finishing}>
              {t.exam.submit}
            </Button>
          </div>
        </aside>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t.exam.questionList}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{navGrid(() => setNavOpen(false))}</div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.exam.submitTitle}</DialogTitle>
            <DialogDescription>
              {unanswered.length
                ? t.exam.unansweredWarn(unanswered.length, unanswered.map((q) => q.position).join(", "))
                : t.exam.allAnswered}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t.exam.keepWorking}
            </Button>
            <Button
              disabled={!!finishing}
              onClick={() => {
                setConfirmOpen(false);
                void finish("manual");
              }}
            >
              {t.exam.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {finishing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90" role="alertdialog" aria-live="assertive">
          <p className="inline-flex items-center gap-2 text-lg font-medium">
            <Loader2 className="size-5 animate-spin" />
            {finishing === "timeout" ? t.exam.timeUp : t.exam.submitting}
          </p>
        </div>
      )}
    </div>
  );
}
