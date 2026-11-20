// 하루 두 번 알림을 Durable Object 알람으로 돌린다.
// 무료 계정 cron 칸(5개)을 다른 프로젝트가 다 써서 cron 대신 쓴다. 알람은 울릴 때마다 다음 칸을 다시 예약한다.
// 「1시간 뒤」(A2)는 같은 알람 하나로 함께 든다: 저장 = 칸 종류(kind) · 칸 시각(slot_at) · 미룬 시각(later_at),
// 예약 = min(칸 시각, 미룬 시각). 울리면 시각이 된 쪽만 실행한다 — 남은 미룬 값이 정규 칸을 가로막지 않게.
//
// 2026-11-03~11-20 알람이 지난 시각(11-02T22:30Z)에 걸린 채 17일 안 울렸다. 처음 멈춘 까닭은 기록이 없어 모른다.
// 그래서 원인과 상관없이: ① 울리기 전 started · 끝난 뒤 last 를 남기고(started 만 있고 last 가 없으면 중간에 죽은 것)
// ② ensure(앱 열 때 · 매일 아침 요약 작업)가 15분 넘게 지난 알람을 멈춤으로 보고 다시 예약 + 디스코드 한 줄
// ③ 실행 실패도 디스코드 한 줄. 운영 알림은 공부 알림 설정(discord_on)과 상관없이 디스코드로 간다.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { runEvening, runMorning, sendTest, webhookUrl } from './notify.ts';
import type { DryResult, RunResult } from './notify.ts';
import { alarmDue, alarmStuck, nextAlarm, nextSlot } from './time.ts';
import { withDb } from './db.ts';
import type { SlotKind } from './time.ts';
import { opsPayload, send } from './discord.ts';

/** 미룬 통이 이만큼 넘게 지났으면 끝난 것으로 본다(새로 미루기 허용) */
const LATER_STALE_MS = 30 * 60_000;

/** 울릴 때마다 남기는 기록(관리 /api/admin/schedule 이 돌려줌) */
export interface FireMark {
  at: string;
  kind: string;
  /** 결과 한 줄: sent · failed · skipped:<이유> · error:<메시지> */
  result?: string;
  ms?: number;
}

export interface ScheduleState {
  next: string;
  kind: SlotKind | 'test';
  started?: FireMark;
  last?: FireMark;
  /** 이번 확인에서 멈춘 알람을 다시 맞췄으면 그 지난 시각 */
  healed?: string;
}

/** 결과를 한 줄로(비밀·글 본문 없이) */
export function resultLine(r: RunResult | DryResult): string {
  if ('skipped' in r) return `skipped:${r.skipped}`;
  if ('dry' in r) return `dry:${r.dry.n}`;
  return r.status === 'sent' ? 'sent' : `failed:${(r.error ?? '').slice(0, 120)}`;
}

export class Scheduler extends DurableObject<Env> {
  private async arm(slotAt: number): Promise<number> {
    // 미룬 시각은 마지막에 다시 읽는다: 실행 중(await 사이)에 「1시간 뒤」가 들어와도 잃지 않게
    const at = nextAlarm(slotAt, await this.ctx.storage.get<number>('later_at'));
    await this.ctx.storage.setAlarm(at);
    return at;
  }

  private async ops(title: string, desc: string): Promise<void> {
    try {
      const hook = await webhookUrl(this.env);
      if (hook) await send(hook, opsPayload(title, desc));
    } catch (e) {
      console.error('ops alert failed', String(e));
    }
  }

  private async marks(): Promise<Pick<ScheduleState, 'started' | 'last'>> {
    return {
      started: await this.ctx.storage.get<FireMark>('started'),
      last: await this.ctx.storage.get<FireMark>('last'),
    };
  }

  /** 알람이 없거나 멈췄으면(15분 넘게 지난 시각) 다음 칸으로 다시 예약하고, 예약 상태를 돌려준다 */
  async ensure(): Promise<ScheduleState> {
    const now = Date.now();
    let at = await this.ctx.storage.getAlarm();
    let kind = (await this.ctx.storage.get<SlotKind | 'test'>('kind')) ?? 'morning';
    let healed: string | undefined;
    if (alarmStuck(at, now)) {
      healed = new Date(at!).toISOString();
      await this.ctx.storage.deleteAlarm();
      at = null;
    }
    if (at === null) {
      const s = nextSlot(new Date(now));
      await this.ctx.storage.put({ kind: s.kind, slot_at: s.at.getTime() });
      at = await this.arm(s.at.getTime());
      kind = s.kind;
    }
    const m = await this.marks();
    if (healed) {
      await this.ctx.storage.put('healed', { at: new Date(now).toISOString(), was: healed });
      await this.ops('Wortling 알림 시계 멈춤 → 다시 맞춤', `걸려 있던 시각 ${healed} · 다음 ${new Date(at).toISOString()} · 마지막 실행 ${m.last?.at ?? '-'} ${m.last?.result ?? ''}`);
    }
    return { next: new Date(at).toISOString(), kind, ...m, ...(healed ? { healed } : {}) };
  }

  /** 점검용: n초 뒤 시험 통 한 번(알람이 실제로 울리는지 확인 — 폰으로 감) → 그 뒤 원래 칸으로 돌아간다 */
  async testIn(sec: number): Promise<{ next: string }> {
    const at = Date.now() + sec * 1000;
    await this.ctx.storage.put({ kind: 'test', slot_at: at });
    return { next: new Date(await this.arm(at)).toISOString() };
  }

  /** 점검용 미리 보기: 이 DO 안에서 아침·저녁 길을 보내기 직전까지 돈다(알림 행·발송 없음) */
  async probe(kind: SlotKind): Promise<{ ok: boolean; result: string; ms: number }> {
    const t0 = Date.now();
    try {
      const r = await withDb(this.env, this.ctx, (env) =>
        kind === 'morning' ? runMorning(env, new Date(), { dry: true }) : runEvening(env, new Date(), 'evening', { dry: true }),
      );
      return { ok: true, result: 'dry' in r ? JSON.stringify(r.dry) : resultLine(r), ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, result: `error:${String(e).slice(0, 300)}`, ms: Date.now() - t0 };
    }
  }

  /** 저녁 알림 「1시간 뒤」: 아직 안 울린 미룬 통이 있으면 거절(여러 기기에서 눌러도 한 번) */
  async later(at: number): Promise<{ ok: boolean; next?: string; error?: string }> {
    const cur = await this.ctx.storage.get<number>('later_at');
    if (cur !== undefined && cur > Date.now() - LATER_STALE_MS) return { ok: false, error: 'already' };
    await this.ctx.storage.put('later_at', at);
    const alarm = await this.ctx.storage.getAlarm();
    await this.ctx.storage.setAlarm(alarm === null ? at : Math.min(alarm, at));
    return { ok: true, next: new Date(at).toISOString() };
  }

  // DB_BACKEND=pg 이면 알람 한 번 동안 env.DB 를 Postgres 어댑터로(worker/db.ts). 아래 실행은 이 env 를 쓴다
  async alarm(): Promise<void> {
    const t0 = Date.now();
    const kind = (await this.ctx.storage.get<SlotKind | 'test'>('kind')) ?? 'morning';
    await this.ctx.storage.put('started', { at: new Date(t0).toISOString(), kind } satisfies FireMark);
    let result = 'none';
    try {
      result = await withDb(this.env, this.ctx, (env) => this.fire(env));
    } catch (e) {
      // DB 연결 등 fire 밖에서 던진 것 — 다음 칸은 아래에서 꼭 다시 잡는다
      result = `error:${String(e).slice(0, 200)}`;
    }
    await this.ctx.storage.put('last', { at: new Date(t0).toISOString(), kind, result, ms: Date.now() - t0 } satisfies FireMark);
    // fire 가 끝까지 못 갔으면 알람이 비거나 지난 시각에 남을 수 있다 → 여기서 한 번 더 확인
    const at = await this.ctx.storage.getAlarm();
    if (at === null || at <= Date.now()) {
      const s = nextSlot(new Date(Date.now() + 60_000));
      await this.ctx.storage.put({ kind: s.kind, slot_at: s.at.getTime() });
      await this.arm(s.at.getTime());
    }
    if (result.startsWith('error:') || result.startsWith('failed')) await this.ops(`Wortling ${kind} 알림 실패`, result);
  }

  private async fire(env: Env): Promise<string> {
    const now = Date.now();
    const kind = (await this.ctx.storage.get<SlotKind | 'test'>('kind')) ?? 'morning';
    const slotAt = await this.ctx.storage.get<number>('slot_at');
    const laterAt = await this.ctx.storage.get<number>('later_at');
    const due = alarmDue(now, slotAt, laterAt);
    const lines: string[] = [];

    if (due.later) {
      try {
        const r = due.laterStale ? { skipped: 'later_stale' } : await runEvening(env, new Date(now), 'evening_later');
        console.log('alarm evening_later', JSON.stringify(r));
        lines.push(`later ${resultLine(r)}`);
      } catch (e) {
        console.error('alarm failed evening_later', String(e));
        lines.push(`error:later ${String(e).slice(0, 150)}`);
      }
      // 실행 중에 새로 미룬 값이 들어왔으면 지우지 않는다
      if ((await this.ctx.storage.get<number>('later_at')) === laterAt) await this.ctx.storage.delete('later_at');
    }

    let nextSlotAt = slotAt;
    if (due.slot) {
      try {
        const r =
          kind === 'test'
            ? await sendTest(env, new Date(now))
            : kind === 'morning'
              ? await runMorning(env, new Date(now))
              : await runEvening(env, new Date(now));
        console.log('alarm', kind, JSON.stringify(r));
        lines.push(resultLine(r));
      } catch (e) {
        // 다시 던지면 알람이 재시도되며 다음 칸 예약이 꼬인다 → 기록만 하고 넘어감(같은 날 같은 통은 DB 가 막음)
        console.error('alarm failed', kind, String(e));
        lines.push(`error:${String(e).slice(0, 200)}`);
      }
      // 방금 울린 칸은 1분 뒤 기준이라 건너뛴다
      const s = nextSlot(new Date(now + 60_000));
      await this.ctx.storage.put({ kind: s.kind, slot_at: s.at.getTime() });
      nextSlotAt = s.at.getTime();
    }
    await this.arm(nextSlotAt ?? nextSlot(new Date(now + 60_000)).at.getTime());
    // 오류가 하나라도 있으면 그 줄을 앞으로(알람()이 디스코드로 보낼지 정함)
    const err = lines.find((l) => l.startsWith('error:') || l.startsWith('failed'));
    return err ?? (lines.join(' · ') || 'nothing_due');
  }
}
