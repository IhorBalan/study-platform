import rehypeShiki from '@shikijs/rehype';
import { MarkdownHooks, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const shikiOptions = {
  // The plain github-light theme has colours below 4.5:1 on a light background.
  themes: { light: 'github-light-high-contrast', dark: 'github-dark' },
  defaultColor: false,
} as const;

// Lesson links go to official docs; keep the learner's place in the lesson.
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * Gives the document's top-level `h2` elements the given ids, in order, so a
 * table of contents built from the same Markdown can link to them.
 */
function headingIds(ids: string[]) {
  return (tree: HastNode) => {
    let index = 0;
    for (const node of tree.children ?? []) {
      if (node.type !== 'element' || node.tagName !== 'h2') continue;
      const id = ids[index];
      index += 1;
      if (id) node.properties = { ...node.properties, id };
    }
  };
}

/**
 * Renders lesson and task Markdown with GitHub tables and highlighted code.
 * `sectionIds` are the ids for its second-level headings, from `lessonOutline`.
 */
export function Markdown({
  children,
  sectionIds,
  compact = false,
}: {
  children: string;
  sectionIds?: string[];
  /** Smaller type and tighter spacing, for lists of short texts such as cards. */
  compact?: boolean;
}) {
  return (
    <div
      className={`prose prose-zinc prose-h2:scroll-mt-4 ${compact ? 'prose-sm prose-p:my-1 prose-pre:my-2' : ''} dark:prose-invert prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-zinc-200 prose-pre:bg-zinc-50 dark:prose-pre:border-zinc-800 dark:prose-pre:bg-zinc-900 max-w-none`}
    >
      <MarkdownHooks
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeShiki, shikiOptions],
          [headingIds, sectionIds ?? []],
        ]}
        fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Rendering…</p>}
        components={components}
      >
        {children}
      </MarkdownHooks>
    </div>
  );
}
