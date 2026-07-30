import { isIDC, IDC_ARITY } from "./operators.ts";
import { norm } from "./normalize.ts";

// ---- IDS 構文木 ----
export type Node = string | { op: string; kids: Node[] }; // string "＊" = ワイルドカード
export const WILD = "＊";

export function toTokens(s: string): string[] {
  return [...s];
}

export function parseNodes(tokens: string[]): Node[] {
  let i = 0;
  const readNode = (): Node => {
    if (i >= tokens.length) return WILD;
    const t = tokens[i++];
    if (isIDC(t)) {
      const n = IDC_ARITY.get(t)!;
      const kids: Node[] = [];
      for (let k = 0; k < n; k++) kids.push(readNode());
      return canon({ op: t, kids });
    }
    return norm(t);
  };
  const nodes: Node[] = [];
  while (i < tokens.length) nodes.push(readNode());
  return nodes;
}

// ⿲abc → ⿰a⿰bc / ⿳abc → ⿱a⿱bc に正規化(構造の揺れを吸収)
function canon(n: { op: string; kids: Node[] }): Node {
  if (n.op === "⿲")
    return {
      op: "⿰",
      kids: [n.kids[0], { op: "⿰", kids: [n.kids[1], n.kids[2]] }],
    };
  if (n.op === "⿳")
    return {
      op: "⿱",
      kids: [n.kids[0], { op: "⿱", kids: [n.kids[1], n.kids[2]] }],
    };
  return n;
}
