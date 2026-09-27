// The playtest log's export shape from a scripted session, with its own clock.
import { describe, expect, it } from "vitest";
import { PLAYTEST_MINUTES, PLAYTEST_VERSION, playtestFileName, PlaytestLog } from "../src/ui/playtest";

describe("playtest log (Session B task 5)", () => {
  it("records a scripted session and exports the expected shape, and stops after thirty minutes", () => {
    let ms = 1000;
    const log = new PlaytestLog(() => ms);
    expect(log.enabled).toBe(false);
    log.record("place", 0, 650, "hut at 3,4"); // off: nothing recorded
    log.start();
    ms += 2500;
    log.record("place", 0, 610, "pier at -5,3 · 60$");
    log.hint("Needs deep water against the shore", false, 0, 610);
    log.hint("Needs deep water against the shore", false, 0, 610); // unchanged: not repeated
    log.hint("Click a cell to place", true, 0, 610); // the default prompt: not logged
    log.step(0, "Build a pier", 0, 610);
    log.step(0, "Build a pier", 0, 610);
    ms += 4000;
    log.step(1, "Buy a boat", 0, 530);
    log.record("warning", 1, 530, "The market has no workers: nothing sold");
    log.sample(1, 530, 2);
    log.sample(1, 530, 2); // same cycle: one sample
    log.record("remove", 1, 550, "walkway at 2,2 · refund 2$");
    ms += 1000;
    log.sample(2, 580, 4);
    const out = log.export("felt slow to earn");
    expect(out.version).toBe(PLAYTEST_VERSION);
    expect(out.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.seconds).toBe(8);
    expect(out.notes).toBe("felt slow to earn");
    expect(out.events.map(e => e.type)).toEqual(["place", "hint", "step", "step", "warning", "remove"]);
    expect(out.events[0]).toEqual({ t: 2.5, type: "place", cycle: 0, money: 610, text: "pier at -5,3 · 60$" });
    expect(out.events[3]).toEqual({ t: 6.5, type: "step", cycle: 0, money: 530, text: "Buy a boat" });
    expect(out.samples).toEqual([{ t: 6.5, cycle: 1, money: 530, population: 2 }, { t: 7.5, cycle: 2, money: 580, population: 4 }]);
    expect(out.summary).toEqual({ placements: 1, removals: 1, warnings: 1, hints: 1, steps: 2, cycles: 2 });
    // Thirty minutes on, the log is full: nothing more goes in, the export says thirty minutes.
    ms += PLAYTEST_MINUTES * 60 * 1000;
    log.record("place", 9, 100, "late");
    log.sample(9, 100, 9);
    expect(log.live).toBe(false);
    const late = log.export("");
    expect(late.events.length).toBe(6);
    expect(late.samples.length).toBe(2);
    expect(late.seconds).toBe(PLAYTEST_MINUTES * 60);
    // Stopped: nothing recorded; restarted: a fresh log.
    log.stop();
    log.start();
    expect(log.export("x").events).toEqual([]);
    expect(playtestFileName("2026-09-27T05:12:33.000Z")).toBe("tidewater-playtest-2026-09-27T05-12.json");
  });
});
