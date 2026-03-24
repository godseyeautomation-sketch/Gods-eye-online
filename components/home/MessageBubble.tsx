import React, { useState, useRef, useCallback } from 'react';
import type { ChatMessage } from '../../services/conversationService';
import { ToolCallCard } from './ToolCallCard';
import { BrainActions } from '../BrainActions';

// ── HTML Preview + PDF Download Block ────────────────────────────────────────
const HtmlPreviewBlock: React.FC<{ html: string }> = ({ html }) => {
  const [showCode, setShowCode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Wrap partial HTML in a full document if needed
  const fullHtml = html.includes('<html') ? html : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;padding:24px;color:#1a1a1a;}</style></head><body>${html}</body></html>`;

  const handleDownloadPdf = useCallback(async () => {
    setGenerating(true);
    try {
      // Use browser print-to-PDF via iframe
      const printWindow = window.open('', '_blank', 'width=800,height=600');
      if (printWindow) {
        printWindow.document.write(fullHtml);
        printWindow.document.close();
        setTimeout(() => {
          printWindow.print();
          printWindow.close();
        }, 500);
      }
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [fullHtml]);

  const handleDownloadHtml = useCallback(() => {
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'godseye-document.html';
    a.click();
    URL.revokeObjectURL(url);
  }, [fullHtml]);

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/8 bg-white/[0.02]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-secondary/50 font-mono uppercase tracking-wider">Document Preview</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCode(!showCode)}
            className="px-2 py-0.5 rounded text-[10px] text-text-secondary/50 hover:text-text-primary hover:bg-white/5 transition-colors"
          >
            {showCode ? 'Preview' : 'Code'}
          </button>
          <button
            onClick={handleDownloadHtml}
            className="px-2 py-0.5 rounded text-[10px] text-text-secondary/50 hover:text-text-primary hover:bg-white/5 transition-colors"
            title="Download HTML"
          >
            HTML ↓
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={generating}
            className="px-2 py-0.5 rounded text-[10px] bg-brand/10 text-brand hover:bg-brand/20 transition-colors disabled:opacity-50"
            title="Print as PDF"
          >
            {generating ? '...' : 'PDF ↓'}
          </button>
        </div>
      </div>

      {/* Content */}
      {showCode ? (
        <pre className="px-4 py-3 overflow-x-auto text-[12px] leading-relaxed max-h-[400px] overflow-y-auto">
          <code className="font-mono text-text-primary/70">{html}</code>
        </pre>
      ) : (
        <iframe
          ref={iframeRef}
          srcDoc={fullHtml}
          className="w-full bg-white rounded-b-xl"
          style={{ minHeight: 300, maxHeight: 600, border: 'none' }}
          sandbox="allow-same-origin allow-scripts"
          title="Document preview"
          onLoad={() => {
            // Auto-resize iframe to content
            const iframe = iframeRef.current;
            if (iframe?.contentDocument?.body) {
              const h = iframe.contentDocument.body.scrollHeight;
              iframe.style.height = Math.min(Math.max(h + 20, 200), 600) + 'px';
            }
          }}
        />
      )}
    </div>
  );
};

interface Props {
  message: ChatMessage;
}

export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!message.content) return;
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // ── Markdown Renderer ──────────────────────────────────────────────────
  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} className="px-1.5 py-0.5 rounded-md bg-white/8 text-[13px] font-mono text-brand/80">{part.slice(1, -1)}</code>;
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch)
        return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{linkMatch[1]}</a>;
      return part;
    });
  };

  const renderText = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code blocks
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim().toLowerCase();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        const codeContent = codeLines.join('\n');
        const isHtml = lang === 'html' || (lang === '' && codeContent.trim().startsWith('<') && codeContent.includes('</'));

        if (isHtml) {
          elements.push(
            <HtmlPreviewBlock key={elements.length} html={codeContent} />
          );
        } else {
          elements.push(
            <div key={elements.length} className="my-3 rounded-xl overflow-hidden border border-white/5">
              {lang && <div className="px-3 py-1 bg-white/5 text-[10px] text-text-secondary/50 font-mono uppercase tracking-wider">{lang}</div>}
              <pre className="px-4 py-3 bg-white/[0.03] overflow-x-auto text-[13px] leading-relaxed">
                <code className="font-mono text-text-primary/80">{codeContent}</code>
              </pre>
            </div>
          );
        }
        continue;
      }

      // Tables: detect | header | header |
      if (line.includes('|') && line.trim().startsWith('|')) {
        const tableLines: string[] = [line];
        i++;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        // Parse table
        const parseRow = (row: string) =>
          row.split('|').slice(1, -1).map(cell => cell.trim());
        const isSeparator = (row: string) => /^[\s|:-]+$/.test(row);

        const headerRow = parseRow(tableLines[0]);
        const dataRows = tableLines
          .slice(1)
          .filter(r => !isSeparator(r))
          .map(parseRow);

        elements.push(
          <div key={elements.length} className="my-3 overflow-x-auto rounded-xl border border-white/8">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.04]">
                  {headerRow.map((h, j) => (
                    <th key={j} className="px-3 py-2 text-left text-[12px] font-semibold text-text-secondary uppercase tracking-wider border-b border-white/8">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-[13px] text-text-primary/80 border-b border-white/5">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) {
        elements.push(<hr key={elements.length} className="my-4 border-white/8" />);
        i++;
        continue;
      }

      // Headers
      if (line.startsWith('### ')) {
        elements.push(<h3 key={elements.length} className="text-[15px] font-bold mt-4 mb-1.5 text-text-primary">{renderInline(line.slice(4))}</h3>);
        i++; continue;
      }
      if (line.startsWith('## ')) {
        elements.push(<h2 key={elements.length} className="text-base font-bold mt-4 mb-1.5 text-text-primary">{renderInline(line.slice(3))}</h2>);
        i++; continue;
      }
      if (line.startsWith('# ')) {
        elements.push(<h1 key={elements.length} className="text-lg font-bold mt-4 mb-1.5 text-text-primary">{renderInline(line.slice(2))}</h1>);
        i++; continue;
      }

      // Unordered list
      if (line.match(/^\s*[-*]\s/)) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^\s*[-*]\s/)) {
          items.push(lines[i].replace(/^\s*[-*]\s/, ''));
          i++;
        }
        elements.push(
          <ul key={elements.length} className="my-2 ml-4 space-y-1">
            {items.map((item, j) => (
              <li key={j} className="list-disc text-[15px] leading-relaxed text-text-primary/85 marker:text-text-secondary/30">
                {renderInline(item)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered list
      const numMatch = line.match(/^\s*(\d+)\.\s/);
      if (numMatch) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^\s*\d+\.\s/)) {
          items.push(lines[i].replace(/^\s*\d+\.\s/, ''));
          i++;
        }
        elements.push(
          <ol key={elements.length} className="my-2 ml-4 space-y-1">
            {items.map((item, j) => (
              <li key={j} className="list-decimal text-[15px] leading-relaxed text-text-primary/85 marker:text-text-secondary/30">
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={elements.length} className="my-2 pl-3 border-l-2 border-brand/30 text-text-secondary text-[14px] italic">
            {renderInline(line.slice(2))}
          </blockquote>
        );
        i++; continue;
      }

      // Empty line
      if (!line.trim()) {
        elements.push(<div key={elements.length} className="h-1.5" />);
        i++; continue;
      }

      // Normal paragraph
      elements.push(
        <p key={elements.length} className="text-[15px] leading-[1.7] text-text-primary/90">
          {renderInline(line)}
        </p>
      );
      i++;
    }

    return elements;
  };

  const handleDownload = async (url: string, prompt?: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `godseye-${(prompt || 'image').slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  return (
    <>
      <div className={`mb-5 ${isUser ? 'flex justify-end' : 'group/msg'}`}>
        <div className={`relative ${
          isUser
            ? 'max-w-[80%] lg:max-w-[65%] bg-white/[0.06] rounded-2xl rounded-br-sm px-4 py-3 border border-white/[0.06]'
            : 'max-w-full pl-1'
        }`}>
          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="space-y-2 mb-3">
              {message.toolCalls.map((tc, i) => (
                <ToolCallCard key={i} toolCall={tc} />
              ))}
            </div>
          )}

          {/* User-attached images */}
          {message.imageDataUrls && message.imageDataUrls.length > 0 && (
            <div className={`grid gap-2 mb-2 ${message.imageDataUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-[200px]'}`}>
              {message.imageDataUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt="Attached"
                  className="rounded-xl w-full cursor-pointer hover:opacity-90 transition-opacity border border-border-base"
                  onClick={() => setExpandedImage(url)}
                />
              ))}
            </div>
          )}

          {/* Text content */}
          {message.content && (
            <div className={isUser ? 'text-text-primary text-[15px]' : 'text-text-primary'}>
              {isUser ? message.content : renderText(message.content)}
            </div>
          )}

          {/* Copy button — AI messages only, non-invasive */}
          {!isUser && message.content && (
            <button
              onClick={handleCopy}
              className="absolute -bottom-5 right-0 opacity-0 group-hover/msg:opacity-60 hover:!opacity-100 transition-all text-[11px] text-text-secondary flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-white/5"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-brand">Copied</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          )}

          {/* Generated Attachments (images/videos from tool calls) */}
          {message.attachments && message.attachments.length > 0 && (
            <div className={`grid gap-2 mt-3 ${message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-md'}`}>
              {message.attachments.map((att, i) => (
                att.type === 'image' ? (
                  <div key={i} className="relative group">
                    <img
                      src={att.url}
                      alt={att.prompt || 'Generated'}
                      className="rounded-xl w-full cursor-pointer hover:opacity-90 transition-opacity border border-border-base"
                      onClick={() => setExpandedImage(att.url)}
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <BrainActions imageUrl={att.url} prompt={att.prompt || 'Generated image'} className="" />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.prompt); }}
                        className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white/70 hover:text-white transition-all backdrop-blur-sm"
                        title="Download"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : att.type === 'video' ? (
                  <div key={i} className="relative group">
                    <video src={att.url} controls className="rounded-xl w-full border border-border-base" />
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <BrainActions imageUrl={att.url} prompt={att.prompt || 'Generated video'} className="" />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(att.url, att.prompt); }}
                        className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white/70 hover:text-white transition-all backdrop-blur-sm"
                        title="Download"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          )}

          {/* Search results */}
          {message.searchResults && message.searchResults.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] text-text-secondary/50 font-medium uppercase tracking-widest">Sources</p>
              {message.searchResults.map((sr, i) => (
                <a key={i} href={sr.url} target="_blank" rel="noopener noreferrer"
                  className="block px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs text-brand truncate border border-white/5">
                  {sr.title}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expanded image modal */}
      {expandedImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8 cursor-pointer" onClick={() => setExpandedImage(null)}>
          <img src={expandedImage} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
        </div>
      )}
    </>
  );
};
