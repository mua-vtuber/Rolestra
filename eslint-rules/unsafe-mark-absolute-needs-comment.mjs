/**
 * ESLint rule — `unsafeMarkAbsolute()` must carry a comment saying why.
 *
 * R12-X T11. `AbsolutePath` is a branded type: the only ways to obtain one are
 * `asAbsolutePath` (which validates) and `unsafeMarkAbsolute` (which does not).
 * The escape hatch exists for values another boundary already proved absolute
 * — `app.getPath('userData')`, a value read back from a column the DB wrote
 * after validation. Used without that justification it silently turns the
 * brand back into a plain string, and the whole R12-X guard is worth nothing.
 *
 * The plan's own risk table asks for exactly this check. `no-restricted-syntax`
 * cannot express it: esquery selectors match AST nodes and cannot see comments,
 * so a selector could only ban every call, including the legitimate ones.
 *
 * Accepted forms of justification (any one is enough):
 *   - a line comment or block comment on the line directly above the call,
 *   - a trailing comment on the same line as the call.
 *
 * The declaration inside `src/shared/absolute-path.ts` and the test files that
 * exercise the hatch are exempted by the config's `files` globs, not here.
 */

/** @type {import('eslint').Rule.RuleModule} */
export const unsafeMarkAbsoluteNeedsComment = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'require a comment explaining why unsafeMarkAbsolute is safe at this call site',
    },
    schema: [],
    messages: {
      missingJustification:
        'unsafeMarkAbsolute() bypasses AbsolutePath validation. Add a comment on the line above (or at the end of this line) naming the boundary that already guarantees this path is absolute.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /**
     * True when a comment sits on the line above the call, or trails it on the
     * same line. Comments further up are not accepted: they usually belong to
     * the enclosing function, not to this call.
     */
    function hasJustification(node) {
      const callLine = node.loc.start.line;

      const before = sourceCode.getCommentsBefore(node);
      for (const comment of before) {
        if (comment.loc.end.line === callLine - 1) return true;
      }

      const after = sourceCode.getCommentsAfter(node);
      for (const comment of after) {
        if (comment.loc.start.line === callLine) return true;
      }

      // A call nested in a larger expression (an argument, a property value)
      // hangs its comments off the ancestor rather than off the call node, so
      // walk up while the ancestor still starts on the same line.
      let current = node.parent;
      while (current && current.loc.start.line === callLine) {
        for (const comment of sourceCode.getCommentsBefore(current)) {
          if (comment.loc.end.line === callLine - 1) return true;
        }
        for (const comment of sourceCode.getCommentsAfter(current)) {
          if (comment.loc.start.line === callLine) return true;
        }
        current = current.parent;
      }

      return false;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' &&
                callee.property.type === 'Identifier'
              ? callee.property.name
              : null;
        if (name !== 'unsafeMarkAbsolute') return;
        if (hasJustification(node)) return;
        context.report({ node, messageId: 'missingJustification' });
      },
    };
  },
};
