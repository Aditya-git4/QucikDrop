import React, { useState, useRef, useEffect } from 'react';
import { CopyButton } from './CopyButton.jsx';
import { validateMessageText } from '../utils/validateInput.js';
import { extractFilesFromClipboard } from '../utils/fileUtils.js';
import { hapticTap, playSendSound } from '../utils/soundEffects.js';
import { MessageSquare, Send, Mic, Square, Clock } from 'lucide-react';

/**
 * Modern chat interface with clean message bubbles, timestamps, sticky input,
 * ephemeral notes, and zero emojis.
 * @param {{
 *   messages: Array<{
 *     id: string,
 *     text: string,
 *     senderPeerId: string,
 *     deviceName: string,
 *     sentAt: number,
 *     isMine: boolean
 *   }>,
 *   onSendMessage: (text: string) => void,
 *   onFilesSelected?: (files: FileList | File[]) => void,
 *   isP2PConnected?: boolean,
 *   isConnected?: boolean,
 *   disabled?: boolean
 * }} props
 */
export function TextTransfer({
  messages,
  onSendMessage,
  onFilesSelected = null,
  isP2PConnected = false,
  isConnected = false,
  disabled = false
}) {
  const [inputText, setInputText] = useState('');
  const [destructSec, setDestructSec] = useState(0); // 0 = off, 30 = 30s, 60 = 60s
  const [evaporatedIds, setEvaporatedIds] = useState(new Set());
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordIntervalRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const maxLength = 4096;

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Periodic check for self-destructing messages
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      messages.forEach((msg) => {
        if (msg.text.startsWith('__EPHEMERAL_')) {
          const match = msg.text.match(/^__EPHEMERAL_(\d+)__(.*)$/s);
          if (match) {
            const ttlMs = parseInt(match[1], 10) * 1000;
            if (now - msg.sentAt >= ttlMs) {
              setEvaporatedIds((prev) => new Set(prev).add(msg.id));
            }
          }
        }
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [messages]);

  const handleSend = () => {
    const { valid } = validateMessageText(inputText, maxLength);
    if (!valid || disabled) return;

    hapticTap();
    let finalPayload = inputText.trim();
    if (destructSec > 0) {
      finalPayload = `__EPHEMERAL_${destructSec}__${finalPayload}`;
    }

    onSendMessage(finalPayload);
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaPaste = (e) => {
    const files = extractFilesFromClipboard(e.clipboardData);
    if (files.length > 0) {
      e.preventDefault();
      hapticTap();
      playSendSound();
      if (onFilesSelected) {
        onFilesSelected(files);
      }
    }
  };

  // Start voice recording
  const startVoiceRecording = async () => {
    if (disabled || isRecordingVoice) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.start();
      setIsRecordingVoice(true);
      setRecordSeconds(0);
      hapticTap();

      recordIntervalRef.current = setInterval(() => {
        setRecordSeconds((sec) => sec + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone access denied or unavailable:', err);
    }
  };

  // Stop recording and send audio memo as a file
  const stopAndSendVoiceRecording = () => {
    if (!mediaRecorderRef.current || !isRecordingVoice) return;

    clearInterval(recordIntervalRef.current);
    const recorder = mediaRecorderRef.current;

    recorder.onstop = () => {
      try {
        recorder.stream?.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      const mime = recorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: mime });
      const ext = mime.includes('mp4') ? 'm4a' : 'webm';
      const audioFile = new File([audioBlob], `voice-memo-${Date.now()}.${ext}`, { type: mime });

      if (onFilesSelected && audioFile.size > 0) {
        onFilesSelected([audioFile]);
      }
      setIsRecordingVoice(false);
      setRecordSeconds(0);
    };

    recorder.stop();
    hapticTap();
    playSendSound();
  };

  const cancelVoiceRecording = () => {
    if (!mediaRecorderRef.current) return;
    clearInterval(recordIntervalRef.current);
    try {
      mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current.stop();
    } catch {
      // ignore
    }
    setIsRecordingVoice(false);
    setRecordSeconds(0);
    hapticTap();
  };

  const remainingChars = maxLength - inputText.length;
  const isOverLimit = remainingChars < 0;
  const visibleMessages = messages.filter((m) => !evaporatedIds.has(m.id));

  // Helper to render text with auto-link detection
  const renderMessageContent = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'inherit',
              textDecoration: 'underline',
              wordBreak: 'break-all'
            }}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div
      className="chat-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg-surface-1)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        minHeight: '440px'
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--color-bg-surface-2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={16} strokeWidth={1.75} style={{ color: '#6366f1' }} />
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Messages
          </span>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 500,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-bg-surface-3)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            {visibleMessages.length}
          </span>
        </div>

        {/* Self-Destructing Timer Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <Clock size={12} strokeWidth={1.75} />
            <span>Auto-delete:</span>
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { val: 0, label: 'Off' },
              { val: 30, label: '30s' },
              { val: 60, label: '60s' }
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => {
                  hapticTap();
                  setDestructSec(opt.val);
                }}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: destructSec === opt.val ? '1px solid #6366f1' : '1px solid var(--border-subtle)',
                  background: destructSec === opt.val ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  color: destructSec === opt.val ? '#6366f1' : 'var(--color-text-secondary)',
                  cursor: 'pointer'
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          padding: '18px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {visibleMessages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
              maxWidth: '300px',
              padding: '24px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <MessageSquare size={32} strokeWidth={1.5} style={{ opacity: 0.5 }} />
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              No messages yet
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Send a quick note or link. Text streams directly peer-to-peer.
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            let displayText = msg.text;
            let isEphemeral = false;
            let secondsRemaining = null;

            if (msg.text.startsWith('__EPHEMERAL_')) {
              const match = msg.text.match(/^__EPHEMERAL_(\d+)__(.*)$/s);
              if (match) {
                isEphemeral = true;
                const ttlSec = parseInt(match[1], 10);
                displayText = match[2];
                const elapsedSec = Math.floor((Date.now() - msg.sentAt) / 1000);
                secondsRemaining = Math.max(0, ttlSec - elapsedSec);
              }
            }

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.isMine ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  alignSelf: msg.isMine ? 'flex-end' : 'flex-start'
                }}
              >
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--color-text-muted)',
                    marginBottom: '3px',
                    padding: '0 4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>{msg.isMine ? 'You' : msg.deviceName} • {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {isEphemeral && (
                    <span style={{ color: 'var(--color-status-relay)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={10} strokeWidth={2} />
                      <span>{secondsRemaining}s</span>
                    </span>
                  )}
                </div>

                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: msg.isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    backgroundColor: msg.isMine ? 'rgba(99, 102, 241, 0.2)' : 'var(--color-bg-surface-2)',
                    color: 'var(--color-text-primary)',
                    border: `1px solid ${
                      isEphemeral
                        ? 'var(--color-status-relay-border)'
                        : msg.isMine
                        ? 'rgba(99, 102, 241, 0.35)'
                        : 'var(--border-subtle)'
                    }`,
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    fontSize: 'var(--font-size-sm)',
                    lineHeight: 1.5
                  }}
                >
                  <div>{renderMessageContent(displayText)}</div>

                  <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}>
                    <CopyButton
                      text={displayText}
                      label="Copy"
                      successLabel="Copied"
                      className="btn-ghost"
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sticky Bottom Input Bar */}
      <div
        style={{
          padding: '12px 14px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--color-bg-surface-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        {isRecordingVoice ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-status-error)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--color-status-error)',
                  animation: 'pulse 1s infinite'
                }}
              />
              <span>Recording: {recordSeconds}s</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={cancelVoiceRecording}
                className="btn btn-secondary"
                style={{ height: '34px', minHeight: '34px', padding: '0 12px', fontSize: 'var(--font-size-xs)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={stopAndSendVoiceRecording}
                className="btn btn-primary"
                style={{ height: '34px', minHeight: '34px', padding: '0 12px', fontSize: 'var(--font-size-xs)' }}
              >
                <Square size={13} strokeWidth={2} />
                <span>Send Memo</span>
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handleTextareaPaste}
              disabled={disabled}
              placeholder={disabled ? 'Room terminated' : 'Type a message... (Enter to send)'}
              rows={2}
              style={{
                flex: 1,
                resize: 'none',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-surface-1)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--color-text-primary)',
                fontFamily: 'inherit',
                fontSize: 'var(--font-size-sm)',
                lineHeight: 1.4,
                outline: 'none'
              }}
            />

            <button
              type="button"
              onClick={startVoiceRecording}
              className="btn-icon"
              disabled={disabled}
              title="Record voice memo"
              aria-label="Record voice memo"
              style={{ height: '40px', minHeight: '40px', width: '40px', minWidth: '40px' }}
            >
              <Mic size={16} strokeWidth={1.75} />
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || !inputText.trim() || isOverLimit}
              className="btn btn-primary"
              style={{ height: '40px', minHeight: '40px', padding: '0 14px' }}
              title="Send message"
              aria-label="Send message"
            >
              <Send size={15} strokeWidth={2} />
            </button>
          </div>
        )}

        {isOverLimit && (
          <div style={{ fontSize: '0.75rem', color: 'var(--color-status-error)' }}>
            Message exceeds limit by {Math.abs(remainingChars)} characters.
          </div>
        )}
      </div>
    </div>
  );
}
