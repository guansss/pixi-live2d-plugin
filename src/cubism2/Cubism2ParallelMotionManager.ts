import { config } from "@/config";
import type { MotionManager } from "@/cubism-common/MotionManager";
import { ParallelMotionManager } from "@/cubism-common/ParallelMotionManager";
import { Cubism2ExpressionManager } from "@/cubism2/Cubism2ExpressionManager";
import type { Cubism2ModelSettings } from "@/cubism2/Cubism2ModelSettings";
import type { Cubism2Spec } from "../types/Cubism2Spec";
import type { Mutable } from "../types/helpers";
import "./patch-motion";

export class Cubism2ParallelMotionManager extends ParallelMotionManager<Live2DMotion, Cubism2Spec.Motion> {
    readonly queueManager = new MotionQueueManager();

    constructor(settings: Cubism2ModelSettings, manager: MotionManager) {
        super(settings, manager);
    }


    isFinished(): boolean {
        return this.queueManager.isFinished();
    }

    protected getMotionName(definition: Cubism2Spec.Motion): string {
        return definition.file;
    }

    protected _startMotion(
        motion: Live2DMotion,
        onFinish?: (motion: Live2DMotion) => void,
    ): number {
        motion.onFinishHandler = onFinish;

        this.queueManager.stopAllMotions();

        return this.queueManager.startMotion(motion);
    }

    protected _stopAllMotions(): void {
        this.queueManager.stopAllMotions();
    }

    protected updateParameters(model: Live2DModelWebGL, now: DOMHighResTimeStamp): boolean {
        return this.queueManager.updateParam(model);
    }

    destroy() {
        super.destroy();

        (this as Partial<Mutable<this>>).queueManager = undefined;
    }
}
