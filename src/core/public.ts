export const CORE_PUBLIC_API_VERSION = "0.0.0";
export const CORE_STAGE = "stage-17";

export interface CoreSmokeProbe {
  readonly apiVersion: typeof CORE_PUBLIC_API_VERSION;
  readonly stage: typeof CORE_STAGE;
  readonly browserApiFree: true;
}

export function createCoreSmokeProbe(): CoreSmokeProbe {
  return {
    apiVersion: CORE_PUBLIC_API_VERSION,
    stage: CORE_STAGE,
    browserApiFree: true
  };
}
