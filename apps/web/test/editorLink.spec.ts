import { describe, expect, it } from 'vitest';
import { editorLink, taskFolder } from '../src/lib/editorLink';

describe('taskFolder', () => {
  it('joins the lab path and the task folder', () => {
    expect(taskFolder('/Users/me/code/lab/', 'm00-foundations/t01-raw-http-server')).toBe(
      '/Users/me/code/lab/m00-foundations/t01-raw-http-server',
    );
  });

  it('keeps Windows separators', () => {
    expect(taskFolder('C:\\code\\lab', 'm00-foundations/t01')).toBe(
      'C:\\code\\lab\\m00-foundations\\t01',
    );
  });
});

describe('editorLink', () => {
  it('builds a link for VS Code and Cursor', () => {
    expect(editorLink('vscode', '/Users/me/my lab/m00/t01')).toEqual({
      href: 'vscode://file/Users/me/my%20lab/m00/t01',
      label: 'Open in VS Code',
    });
    expect(editorLink('cursor', 'C:\\code\\lab\\m00\\t01')).toEqual({
      href: 'cursor://file/C:/code/lab/m00/t01',
      label: 'Open in Cursor',
    });
  });

  it('encodes characters that would cut the path short', () => {
    expect(editorLink('vscode', '/Users/me/C#/what?/lab')?.href).toBe(
      'vscode://file/Users/me/C%23/what%3F/lab',
    );
  });

  it('gives no link when the learner turned it off', () => {
    expect(editorLink('none', '/Users/me/lab/m00/t01')).toBeNull();
  });
});
