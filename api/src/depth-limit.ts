// Rejects queries nested deeper than a limit before they execute. Nesting is how one GraphQL request
// fans out into thousands of database calls (case -> sessions -> device -> maintenance -> device -> ...).
import { GraphQLError, Kind, type ASTVisitor, type FragmentDefinitionNode, type SelectionSetNode, type ValidationContext } from "graphql";

export function depthLimit(max: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions)
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);

    const depthOf = (set: SelectionSetNode | undefined, seen: Set<string>): number => {
      if (!set) return 0;
      let deepest = 0;
      for (const sel of set.selections) {
        if (sel.kind === Kind.FIELD) {
          if (sel.name.value.startsWith("__")) continue;               // introspection fields
          deepest = Math.max(deepest, sel.selectionSet ? 1 + depthOf(sel.selectionSet, seen) : 1);
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          deepest = Math.max(deepest, depthOf(sel.selectionSet, seen));
        } else {
          const name = sel.name.value;
          if (seen.has(name)) continue;                                // cyclic fragments are reported by another rule
          deepest = Math.max(deepest, depthOf(fragments.get(name)?.selectionSet, new Set(seen).add(name)));
        }
      }
      return deepest;
    };

    return {
      OperationDefinition(node) {
        const depth = depthOf(node.selectionSet, new Set());
        if (depth > max) context.reportError(new GraphQLError(`Query depth ${depth} exceeds the limit of ${max}`, { nodes: [node] }));
      },
    };
  };
}
