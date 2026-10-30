import React, { useState, useRef, useEffect } from 'react';
import { validateMessageText } from '../utils/validateInput.js';
import { hapticTap, playSendSound } from '../utils/soundEffects.js';
import { extractFilesFromClipboard, readDeviceClipboard } from '../utils/fileUtils.js';
import {
  Plus,
  Paperclip,
  Send,
  Mic,
  Square,
  Clock,
  Files,
  FolderUp,
  Camera,
  Clipboard,
  Check
} from 'lucide-react';

/**
 * Pinned Room Composer.
 * - Single rounded container pinned at the bottom of the timeline
 * - Attach button with popup menu (Files, Folder, Camera, Paste)
 * - Auto-growing textarea (1 to 5 lines then internal scroll)
 * - Voice memo recording
 * - Auto-delete duration selector (Off / 30s / 60s)
 * - Gradient send button (disabled when empty)
 */
export function RoomComposer({
  onSendMessage,
  onFilesSelected,
  disabled = false,
  disabledReason = null,
  maxLength = 4000
}) {
  const [inputText, setInputText] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showAutoDeleteMenu, setShowAutoDeleteMenu] = useState(false);
  const [destructSec, setDestructSec] = useState(0); // 0 (off), 30, 60

  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // Auto-grow textarea up to 5 lines, then scroll
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    if (!inputText) {
      el.style.height = '38px';
      el.style.overflowY = 'hidden';
      return;
    }
    const scrollH = el.scrollHeight;
    const newHeight = Math.min(scrollH, 120); // max 5 lines ~ 120px
    el.style.height = `${Math.max(newHeight, 38)}px`;
    el.style.overflowY = scrollH > 120 ? 'auto' : 'hidden';
  }, [inputText]);

  // Handle outside click to close popovers
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.attach-menu-container')) {
        setShowAttachMenu(false);
      }
      if (!e.target.closest('.autodelete-menu-container')) {
        setShowAutoDeleteMenu(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

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
    if (textareaRef.current) {
      textareaRef.current.style.height = '38px';
      textareaRef.current.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e) => {
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

  // Voice recording
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

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `Voice_Note_${Date.now()}.webm`, {
          type: 'audio/webm'
        });
        if (onFilesSelected) {
          onFilesSelected([audioFile]);
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecordingVoice(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone permission denied:', err);
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecordingVoice) {
      mediaRecorderRef.current.stop();
      setIsRecordingVoice(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      hapticTap();
      playSendSound();
      onFilesSelected(Array.from(e.target.files));
      e.target.value = '';
      setShowAttachMenu(false);
    }
  };

  const handleDevicePasteClick = async () => {
    setShowAttachMenu(false);
    try {
      const data = await readDeviceClipboard();
      if (data.files && data.files.length > 0) {
        hapticTap();
        playSendSound();
        onFilesSelected(data.files);
      } else if (data.text) {
        setInputText((prev) => (prev ? `${prev} ${data.text}` : data.text));
      }
    } catch {
      // ignore
    }
  };

  const hasContent = Boolean(inputText.trim());

  return (
    <div className="composer-container" aria-label="Message and file composer">
      {/* Hidden file pickers */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Main Composer Box */}
      <div className={`composer-box ${hasContent ? 'composer-has-text' : ''}`}>
        {/* Left: Attach Popover Button */}
        <div className="attach-menu-container">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowAttachMenu((prev) => !prev);
            }}
            disabled={disabled}
            className="composer-action-btn"
            title="Attach files, folder or photo"
            aria-label="Attach files, folder or photo"
            aria-expanded={showAttachMenu}
          >
            <Plus size={18} strokeWidth={2} style={{ transform: showAttachMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {showAttachMenu && (
            <div className="composer-popover attach-popover" role="menu">
              <button
                type="button"
                className="popover-item"
                onClick={() => fileInputRef.current?.click()}
                role="menuitem"
              >
                <Files size={15} strokeWidth={1.75} />
                <span>Files</span>
              </button>
              <button
                type="button"
                className="popover-item"
                onClick={() => folderInputRef.current?.click()}
                role="menuitem"
              >
                <FolderUp size={15} strokeWidth={1.75} />
                <span>Folder</span>
              </button>
              <button
                type="button"
                className="popover-item"
                onClick={() => cameraInputRef.current?.click()}
                role="menuitem"
              >
                <Camera size={15} strokeWidth={1.75} />
                <span>Camera</span>
              </button>
              <button
                type="button"
                className="popover-item"
                onClick={handleDevicePasteClick}
                role="menuitem"
              >
                <Clipboard size={15} strokeWidth={1.75} />
                <span>Paste from Clipboard</span>
              </button>
            </div>
          )}
        </div>

        {/* Center: Textarea or Recording State */}
        {isRecordingVoice ? (
          <div className="composer-recording-bar">
            <span className="recording-indicator pulse" />
            <span className="recording-timer">
              Recording voice note: {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')}
            </span>
            <button
              type="button"
              onClick={stopVoiceRecording}
              className="btn btn-primary btn-stop-recording"
              aria-label="Stop and send voice note"
            >
              <Square size={13} fill="currentColor" />
              <span>Send Note</span>
            </button>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            placeholder={disabledReason || "Type a message or drop files anywhere..."}
            className="composer-textarea"
            aria-label="Type message"
          />
        )}

        {/* Right Actions: Auto-delete clock menu, Mic, Send */}
        <div className="composer-right-actions">
          {/* Auto-delete clock menu */}
          <div className="autodelete-menu-container">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAutoDeleteMenu((prev) => !prev);
              }}
              className={`composer-action-btn ${destructSec > 0 ? 'action-active' : ''}`}
              title={destructSec > 0 ? `Auto-delete in ${destructSec}s` : 'Auto-delete timer (Off)'}
              aria-label="Set auto-delete duration"
              aria-expanded={showAutoDeleteMenu}
            >
              <Clock size={16} strokeWidth={1.75} />
              {destructSec > 0 && <span className="destruct-badge">{destructSec}s</span>}
            </button>

            {showAutoDeleteMenu && (
              <div className="composer-popover autodelete-popover" role="menu">
                <span className="popover-title">Disappearing messages</span>
                {[
                  { sec: 0, label: 'Off' },
                  { sec: 30, label: '30 seconds' },
                  { sec: 60, label: '60 seconds' }
                ].map((opt) => (
                  <button
                    key={opt.sec}
                    type="button"
                    className={`popover-item ${destructSec === opt.sec ? 'item-selected' : ''}`}
                    onClick={() => {
                      setDestructSec(opt.sec);
                      setShowAutoDeleteMenu(false);
                    }}
                    role="menuitem"
                  >
                    <span>{opt.label}</span>
                    {destructSec === opt.sec && <Check size={13} strokeWidth={2} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Voice Memo Mic button */}
          {!isRecordingVoice && (
            <button
              type="button"
              onClick={startVoiceRecording}
              disabled={disabled}
              className="composer-action-btn"
              title="Record voice note"
              aria-label="Record voice note"
            >
              <Mic size={16} strokeWidth={1.75} />
            </button>
          )}

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!hasContent || disabled}
            className={`composer-send-btn ${hasContent ? 'send-ready' : ''}`}
            title="Send message (Enter)"
            aria-label="Send message"
          >
            <Send size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
