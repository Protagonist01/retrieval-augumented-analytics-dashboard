"use client";

import React, { useState, useRef, KeyboardEvent, useEffect } from "react";

interface QueryInputProps {
  onSubmit: (question: string) => void;
  isStreaming: boolean;
  onCancel: () => void;
}

const SUGGESTIONS = [
  "Which product category had the highest total revenue?",
  "Show monthly order counts for 2024",
  "Who are the top 10 customers by total spend?",
  "What is the average order value by country?"
];

export default function QueryInput({ onSubmit, isStreaming, onCancel }: QueryInputProps) {
  const [question, setQuestion] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height as content changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [question]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleFormSubmit();
    }
  };

  const handleFormSubmit = () => {
    if (question.trim() && !isStreaming) {
      onSubmit(question.trim());
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (!isStreaming) {
      setQuestion(suggestion);
      textareaRef.current?.focus();
    }
  };

  return (
    <div className="query-input-container fade-in">
      <style jsx>{`
        .query-input-container {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .input-box {
          position: relative;
          display: flex;
          flex-direction: column;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 1rem;
          box-shadow: var(--shadow-card);
          transition: border-color var(--transition), box-shadow var(--transition);
        }
        .input-box:focus-within {
          border-color: var(--accent-primary);
          box-shadow: var(--shadow-glow), var(--shadow-card);
        }
        textarea {
          width: 100%;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 1rem;
          resize: none;
          line-height: 1.5;
          min-height: 48px;
          padding-bottom: 2rem;
        }
        textarea::placeholder {
          color: var(--text-muted);
        }
        .footer-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: absolute;
          bottom: 12px;
          left: 16px;
          right: 16px;
          pointer-events: none;
        }
        .shortcut-hint {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .char-counter {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
        }
        .btn {
          padding: 0.6rem 1.2rem;
          border-radius: var(--radius-md);
          font-weight: 500;
          font-size: 0.9rem;
          cursor: pointer;
          border: none;
          outline: none;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transition: transform 0.1s ease, opacity var(--transition);
        }
        .btn:active {
          transform: scale(0.98);
        }
        .btn-submit {
          background: var(--accent-primary);
          color: #ffffff;
          box-shadow: 0 8px 20px rgba(31, 138, 91, 0.2);
        }
        .btn-submit:hover:not(:disabled) {
          background: #18774e;
        }
        .btn-submit:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btn-cancel {
          background: rgba(194, 65, 61, 0.1);
          color: var(--error);
          border: 1px solid rgba(194, 65, 61, 0.22);
        }
        .btn-cancel:hover {
          background: rgba(194, 65, 61, 0.16);
        }
        .suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .chip {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background var(--transition), border-color var(--transition), color var(--transition);
        }
        .chip:hover:not(:disabled) {
          background: var(--bg-card-hover);
          border-color: var(--border-accent);
          color: var(--text-primary);
        }
        .chip:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>

      <div className="input-box">
        <textarea
          ref={textareaRef}
          placeholder="Ask a question about your data..."
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          rows={1}
        />
        <div className="footer-info">
          <span className="shortcut-hint">Ctrl+Enter to submit</span>
          <span className="char-counter">{question.length}/500</span>
        </div>
      </div>

      <div className="actions">
        {isStreaming ? (
          <button 
            type="button" 
            className="btn btn-cancel" 
            onClick={onCancel}
            data-testid="cancel-button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-submit"
            onClick={handleFormSubmit}
            disabled={!question.trim()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Ask AI
          </button>
        )}
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map((s, idx) => (
          <button
            key={idx}
            type="button"
            className="chip"
            onClick={() => handleSuggestionClick(s)}
            disabled={isStreaming}
            data-testid="suggestion-chip"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
