import { config } from "@/config";
import { SoundManager } from "@/cubism-common";
import { Cubism4InternalModel, Cubism4ModelSettings } from "@/cubism4";
import { afterEach, beforeEach, expect } from "vitest";
import soundUrl from "../assets/shizuku/sounds/tapBody_00.mp3";
import { TEST_MODEL4, test } from "../env";

beforeEach(() => {
    config.sound = true;
});

afterEach(() => {
    SoundManager.destroy();
});

test("lip sync", async () => {
    const mouthParam = "ParamMouthOpenY";
    const model = new Cubism4InternalModel(
        await TEST_MODEL4.coreModel(),
        new Cubism4ModelSettings(TEST_MODEL4.modelJsonWithUrl),
        { idleMotionGroup: "nonExistent" },
    );

    expect(model.coreModel.getParameterValueById(mouthParam), "initial value").toBe(0);

    await expect(model.lipSync.play(soundUrl, { volume: 1 })).resolves.toBe(undefined);

    const audio = model.lipSync.currentAudio!;
    expect(audio).toBeTruthy();

    function getParamInBetween([begin, end]: number[]) {
        return new Promise<number>((resolve) => {
            const run = () => {
                setTimeout(() => {
                    const currentTime = model.lipSync.audioContext!.currentTime;

                    if (currentTime > audio.duration) {
                        throw new Error("audio duration exceeded");
                    }

                    if (currentTime < begin! || currentTime > end!) {
                        run();
                        return;
                    }

                    let value = NaN;

                    model.once("beforeModelUpdate", () => {
                        value = model.coreModel.getParameterValueById(mouthParam);
                    });
                    model.update(100, performance.now());

                    resolve(value);
                });
            };

            run();
        });
    }

    const silentPeriod = [0.1, 0.45];
    const voicePeriod = [0.55, 0.85];

    await expect(getParamInBetween(silentPeriod), "silent value").resolves.toBe(0);
    await expect(getParamInBetween(voicePeriod), "voice value").resolves.toBeGreaterThan(0);
});

test("lip sync aborted", async () => {
    const model = new Cubism4InternalModel(
        await TEST_MODEL4.coreModel(),
        new Cubism4ModelSettings(TEST_MODEL4.modelJsonWithUrl),
        { idleMotionGroup: "nonExistent" },
    );

    await expect(model.lipSync.play(soundUrl)).resolves.toBe(undefined);
    model.lipSync.stop();

    expect(model.lipSync.currentAudio).toBe(undefined);
    expect(SoundManager.audios.length).toBe(0);
});
