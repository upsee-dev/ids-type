/** 同梱しているIRG審査資料のスナップショット。システムIMEには含めない。 */
export const IRG_WORKING_SETS = ["ws2015", "ws2017", "ws2021", "ws2024"] as const;
export type IrgWorkingSet = (typeof IRG_WORKING_SETS)[number];

export interface IrgEntry {
  sn: string;
  ids: string;
  /** Unihanの字源と一致した文字だけ。提案資料のPUA符号位置は使わない。 */
  chars: string[];
  refs: string[];
}

export function irgEntryUrl(ws: IrgWorkingSet, sn: string): string {
  return `https://hc.jsecs.org/irg/${ws}/app/?id=${encodeURIComponent(sn)}`;
}
