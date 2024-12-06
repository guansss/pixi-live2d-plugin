import { ParallelMotionManager } from "@/cubism-common/ParallelMotionManager";
import type { Cubism4ModelSettings } from "@/cubism4/Cubism4ModelSettings";
import type { CubismSpec } from "@cubism/CubismSpec";
import type { CubismModel } from "@cubism/model/cubismmodel";
import type { ACubismMotion } from "@cubism/motion/acubismmotion";
import { CubismMotion } from "@cubism/motion/cubismmotion";
import { CubismMotionQueueManager } from "@cubism/motion/cubismmotionqueuemanager";
import type { Mutable } from "../types/helpers";
import type { MotionManager } from "@/cubism-common/MotionManager";

import { logger } from "@/utils";

export class Cubism4ParallelMotionManager extends ParallelMotionManager<CubismMotion, CubismSpec.Motion> {
    readonly queueManager = new CubismMotionQueueManager();

    declare readonly settings: Cubism4ModelSettings;

    constructor(settings: Cubism4ModelSettings, manager: MotionManager) {
        super(settings, manager);

        this.init();
    }

    protected init() {
        this.queueManager.setEventCallback((caller, eventValue, customData) => {
            this.emit("motion:" + eventValue);
        });
    }

    isFinished(): boolean {
        return this.queueManager.isFinished();
    }

    protected _startMotion(
        motion: CubismMotion,
        onFinish?: (motion: CubismMotion) => void,
    ): number {
        motion.setFinishedMotionHandler(onFinish as (motion: ACubismMotion) => void);

        this.queueManager.stopAllMotions();
        return this.queueManager.startMotion(motion, false, performance.now());
    }

    protected _stopAllMotions(): void {
        this.queueManager.stopAllMotions();
    }

    protected updateParameters(model: CubismModel, now: DOMHighResTimeStamp): boolean {
        return this.queueManager.doUpdateMotion(model, now);
    }

    protected getMotionName(definition: CubismSpec.Motion): string {
        return definition.File;
    }

    destroy() {
        super.destroy();

        this.queueManager.release();
        (this as Partial<Mutable<this>>).queueManager = undefined;
    }
}
