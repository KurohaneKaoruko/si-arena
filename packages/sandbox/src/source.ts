import { parse, type Node } from "acorn";

/** Executed only in the isolated child; platform policy, billed outside the player cpuMs budget. */
export function checkSource(source: string): void {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  walk(ast, 0);
}

function walk(node: Node, functionDepth: number): void {
  if (node.type === "ImportDeclaration" || node.type === "ImportExpression")
    throw new SyntaxError("Player modules cannot import code");
  const fields = node as Node & Record<string, unknown>;
  if (
    (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
    fields.source != null
  )
    throw new SyntaxError("Export forwarding is disabled");
  if (
    functionDepth === 0 &&
    (node.type === "AwaitExpression" || (node.type === "ForOfStatement" && fields.await === true))
  )
    throw new SyntaxError("Top-level await is disabled");
  const depth = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)
    ? functionDepth + 1
    : functionDepth;
  for (const value of Object.values(fields)) {
    if (Array.isArray(value))
      for (const item of value) {
        if (isNode(item)) walk(item, depth);
      }
    else if (isNode(value)) walk(value, depth);
  }
}

function isNode(value: unknown): value is Node {
  return (
    value !== null && typeof value === "object" && "type" in value && typeof value.type === "string"
  );
}
