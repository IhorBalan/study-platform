import rehypeShiki from '@shikijs/rehype';
import { MarkdownHooks, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const shikiOptions = {
  themes: { light: 'github-light', dark: 'github-dark' },
  defaultColor: false,
} as const;

// Lesson links go to official docs; keep the learner's place in the lesson.
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

/** Renders lesson and task Markdown with GitHub tables and highlighted code. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-zinc dark:prose-invert prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-zinc-200 prose-pre:bg-zinc-50 dark:prose-pre:border-zinc-800 dark:prose-pre:bg-zinc-900 max-w-none">
      <MarkdownHooks
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeShiki, shikiOptions]]}
        fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Rendering…</p>}
        components={components}
      >
        {children}
      </MarkdownHooks>
    </div>
  );
}
