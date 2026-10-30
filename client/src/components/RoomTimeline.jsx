import React, { useState, useRef, useEffect, useMemo } from 'react';
import { formatBytes } from '../utils/formatBytes.js';
import { hapticTap } from '../utils/soundEffects.js';
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Code,
  File,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Download,
  RotateCw,
  X,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Zap,
  ArrowDown
} from 'lucide-react';

/**
 * Truncate filename keeping the file extension visible.
 */
function truncateFilename(name = '', maxLen = 32) {
  if (!name || name.length <= maxLen) return name;
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) {
    return name.slice(0, maxLen - 3) + '...';
  }
  const ext = name.slice(lastDot);
  const base = name.slice(0, lastDot);
  const avail = maxLen - ext.length - 3;
  if (avail <= 4) return name.slice(0, maxLen - 3) + '...';
  return base.slice(0, avail) + '...' + ext;
}

/**
 * Determine icon type for file.
 */
function getFileCategoryIcon(mimeType = '', fileName = '') {
  const mime = mimeType.toLowerCase();
  const name = fileName.toLowerCase();

  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg|avif)$/.test(name)) {
    return <ImageIcon size={18} strokeWidth={1.75} />;
  }
  if (mime.startsWith('video/') || /\.(mp4|webm|mkv|mov|avi)$/.test(name)) {
    return <Film size={18} strokeWidth={1.75} />;
  }
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|webm)$/.test(name)) {
    return <Music size={18} strokeWidth={1.75} />;
  }
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed') || /\.(zip|tar|gz|7z|rar)$/.test(name)) {
    return <Archive size={18} strokeWidth={1.75} />;
  }
  if (mime.includes('javascript') || mime.includes('json') || mime.includes('html') || /\.(js|jsx|ts|tsx|html|css|json|py|rs|go)$/.test(name)) {
    return <Code size={18} strokeWidth={1.75} />;
  }
  if (mime.includes('pdf') || /\.(pdf|doc|docx|txt|md)$/.test(name)) {
    return <FileText size={18} strokeWidth={1.75} />;
  }
  return <File size={18} strokeWidth={1.75} />;
}

/**
 * Unified Room Timeline.
 * Merges text messages and file transfers into a single chronological feed.
 * Features:
 * - Date dividers ("Today")
 * - Text bubbles with tail, copy on hover, link detection
 * - File bubbles with thumbnails, status chips, actions
 * - Batch grouping (>= 3 files queued/sent within seconds collapsed into 1 row with internal scroll)
 * - Pinned "Active transfers" summary strip above composer
 * - Smart scroll to bottom + floating "New items" indicator
 */
export function RoomTimeline({
  messages = [],
  transfers = [],
  myDeviceName = 'You',
  peerDeviceName = 'Peer',
  onRetryTransfer,
  onCancelTransfer,
  connectionType = 'direct'
}) {
  const scrollContainerRef = useRef(null);
  const bottomAnchorRef = useRef(null);

  const [copiedId, setCopiedId] = useState(null);
  const [expandedBatchIds, setExpandedBatchIds] = useState(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Merge and sort all items chronologically
  const unifiedTimeline = useMemo(() => {
    const rawItems = [];

    messages.forEach((m) => {
      rawItems.push({
        id: m.id || `msg-${m.timestamp}`,
        kind: 'message',
        timestamp: m.timestamp || Date.now(),
        data: m
      });
    });

    transfers.forEach((t) => {
      rawItems.push({
        id: t.transferId || `tx-${t.streamId || Math.random()}`,
        kind: 'transfer',
        timestamp: t.createdAt || Date.now(),
        data: t
      });
    });

    // Sort ascending by time
    rawItems.sort((a, b) => a.timestamp - b.timestamp);

    // Group adjacent batch transfers (>= 3 files within 5 seconds in the same direction)
    const grouped = [];
    let i = 0;
    while (i < rawItems.length) {
      const current = rawItems[i];
      if (current.kind === 'transfer') {
        const batch = [current];
        let j = i + 1;
        while (j < rawItems.length) {
          const next = rawItems[j];
          if (
            next.kind === 'transfer' &&
            next.data.direction === current.data.direction &&
            Math.abs(next.timestamp - current.timestamp) <= 5000
          ) {
            batch.push(next);
            j++;
          } else {
            break;
          }
        }

        if (batch.length >= 3) {
          grouped.push({
            id: `batch-${batch[0].id}`,
            kind: 'batch',
            timestamp: batch[0].timestamp,
            direction: batch[0].data.direction,
            items: batch.map((b) => b.data)
          });
          i = j;
          continue;
        }
      }

      grouped.push(current);
      i++;
    }

    return grouped;
  }, [messages, transfers]);

  // Track active transfers for pinned strip
  const activeTransfers = useMemo(() => {
    return transfers.filter((t) => t.status === 'transferring');
  }, [transfers]);

  // Scroll handler to detect if user is near bottom
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceToBottom < 120;
    setIsNearBottom(near);
    if (near) {
      setUnreadCount(0);
    }
  };

  // Initial mount scroll: jump immediately to newest item at the bottom
  const hasInitiallyScrolledRef = useRef(false);
  useEffect(() => {
    if (!hasInitiallyScrolledRef.current && unifiedTimeline.length > 0) {
      hasInitiallyScrolledRef.current = true;
      const scrollToBottomDirect = () => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      };
      scrollToBottomDirect();
      const raf = requestAnimationFrame(scrollToBottomDirect);
      const timer = setTimeout(scrollToBottomDirect, 80);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [unifiedTimeline.length]);

  // Auto-scroll when new items arrive if near bottom; otherwise increment unreadCount
  const prevCountRef = useRef(unifiedTimeline.length);
  useEffect(() => {
    const diff = unifiedTimeline.length - prevCountRef.current;
    if (diff > 0) {
      if (isNearBottom) {
        bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        setUnreadCount((prev) => prev + diff);
      }
    }
    prevCountRef.current = unifiedTimeline.length;
  }, [unifiedTimeline.length, isNearBottom]);

  const scrollToBottom = () => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadCount(0);
  };

  const handleCopyText = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const toggleBatch = (batchId) => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  // Format message time
  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="timeline-wrapper">
      {/* Pinned Active Transfers Summary Strip (above composer) */}
      {activeTransfers.length > 0 && (
        <div
          className="active-transfers-strip"
          role="status"
          aria-live="polite"
          onClick={() => {
            const firstActive = document.querySelector('.timeline-item-transfer.status-transferring');
            firstActive?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        >
          <div className="active-strip-left">
            <Zap size={14} className="active-strip-icon" />
            <span className="active-strip-text">
              {activeTransfers[0].direction === 'send' ? 'Sending' : 'Receiving'}{' '}
              {activeTransfers.length} {activeTransfers.length === 1 ? 'file' : 'files'}
            </span>
            {activeTransfers[0].speed > 0 && (
              <span className="active-strip-speed">
                · {formatBytes(activeTransfers[0].speed)}/s
              </span>
            )}
          </div>
          <div className="active-strip-bar">
            <div
              className="active-strip-bar-fill"
              style={{
                width: `${activeTransfers[0].progress || 0}%`
              }}
            />
          </div>
        </div>
      )}

      {/* Main Scroll Container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="room-timeline"
        tabIndex={0}
        aria-label="Room message and file transfer timeline"
      >
        {unifiedTimeline.length === 0 ? (
          <div className="timeline-empty-state">
            <div className="empty-state-svg-wrapper">
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="12" cy="12" r="10" strokeDasharray="3 3" />
                <path d="M12 8v8" />
                <path d="m8 12 4-4 4 4" />
              </svg>
            </div>
            <h3 className="empty-state-title">No activity yet</h3>
            <p className="empty-state-caption">Drop a file anywhere or type a message below to start</p>
          </div>
        ) : (
          <>
            {/* Date divider */}
            <div className="timeline-date-divider">
              <span className="date-divider-pill">Today</span>
            </div>

            {unifiedTimeline.map((item) => {
              if (item.kind === 'message') {
                const msg = item.data;
                const isSelf = msg.isSelf !== undefined ? msg.isSelf : msg.senderPeerId === 'me-peer' || msg.deviceName === myDeviceName;

                // Strip ephemeral payload prefix if present
                let displayText = msg.text || '';
                const ephemMatch = displayText.match(/^__EPHEMERAL_\d+__(.*)$/s);
                if (ephemMatch) {
                  displayText = ephemMatch[1];
                }

                return (
                  <div
                    key={item.id}
                    className={`timeline-item timeline-item-message ${isSelf ? 'msg-self' : 'msg-peer'}`}
                  >
                    <div className="message-bubble-wrapper">
                      <div className="message-bubble">
                        <p className="message-text">
                          {/* Auto-link detection */}
                          {displayText.split(/(https?:\/\/[^\s]+)/g).map((part, idx) =>
                            part.match(/^https?:\/\//) ? (
                              <a
                                key={idx}
                                href={part}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="message-link"
                              >
                                {part}
                              </a>
                            ) : (
                              part
                            )
                          )}
                        </p>

                        <div className="bubble-meta">
                          <span className="bubble-time">{formatTime(item.timestamp)}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyText(item.id, displayText)}
                            className="bubble-copy-btn"
                            title="Copy text"
                            aria-label="Copy text"
                          >
                            {copiedId === item.id ? (
                              <Check size={11} className="copy-check" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              if (item.kind === 'batch') {
                const isExpanded = expandedBatchIds.has(item.id);
                const isSelf = item.direction === 'send';
                const totalBytes = item.items.reduce((acc, f) => acc + (f.fileSize || 0), 0);
                const completedCount = item.items.filter((f) => f.status === 'completed').length;
                const overallPct = Math.round((completedCount / item.items.length) * 100);

                return (
                  <div
                    key={item.id}
                    className={`timeline-item timeline-item-batch ${isSelf ? 'batch-self' : 'batch-peer'}`}
                  >
                    <div className="batch-bubble">
                      <div className="batch-header" onClick={() => toggleBatch(item.id)}>
                        <div className="batch-header-left">
                          <div className="batch-icon-tile">
                            <Archive size={18} strokeWidth={1.75} />
                          </div>
                          <div>
                            <div className="batch-title">
                              <span>{item.items.length} files</span>
                              <span className="dot-sep">•</span>
                              <span>{formatBytes(totalBytes)}</span>
                            </div>
                            <div className="batch-sub">
                              {completedCount === item.items.length
                                ? 'All files completed'
                                : `${completedCount} of ${item.items.length} transferred (${overallPct}%)`}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn-icon batch-toggle-btn"
                          aria-label={isExpanded ? 'Collapse batch' : 'Expand batch'}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>

                      {/* Progress bar */}
                      <div className="batch-progress-track">
                        <div className="batch-progress-fill" style={{ width: `${overallPct}%` }} />
                      </div>

                      {/* Expanded rows with max-height ~320px and internal scroll */}
                      {isExpanded && (
                        <div className="batch-items-scroll">
                          {item.items.map((file) => (
                            <div key={file.transferId} className="batch-file-row">
                              <div className="batch-row-left">
                                <span className="batch-row-icon">
                                  {getFileCategoryIcon(file.fileType, file.fileName)}
                                </span>
                                <span className="batch-row-name" title={file.fileName}>
                                  {truncateFilename(file.fileName, 28)}
                                </span>
                              </div>
                              <div className="batch-row-right">
                                <span className="batch-row-size">{formatBytes(file.fileSize)}</span>
                                {file.status === 'completed' && (
                                  <CheckCircle2 size={13} className="text-direct" />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              if (item.kind === 'transfer') {
                const tx = item.data;
                const isSelf = tx.direction === 'send';
                const isImage = (tx.fileType && tx.fileType.startsWith('image/')) || Boolean(tx.url);

                return (
                  <div
                    key={item.id}
                    className={`timeline-item timeline-item-transfer status-${tx.status} ${isSelf ? 'tx-self' : 'tx-peer'}`}
                  >
                    <div className="transfer-bubble">
                      <div className="transfer-bubble-top">
                        {/* File preview / icon */}
                        <div className="transfer-visual">
                          {isImage && tx.url ? (
                            <img src={tx.url} alt="" className="transfer-thumb" />
                          ) : (
                            <div className="transfer-icon-tile">
                              {getFileCategoryIcon(tx.fileType, tx.fileName)}
                            </div>
                          )}
                        </div>

                        {/* File Meta */}
                        <div className="transfer-meta">
                          <div className="transfer-name-row">
                            <span className="transfer-name" title={tx.fileName}>
                              {truncateFilename(tx.fileName, 34)}
                            </span>
                            <span className="transfer-direction-icon">
                              {isSelf ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
                            </span>
                          </div>

                          <div className="transfer-details">
                            <span>{formatBytes(tx.fileSize)}</span>
                            <span className="dot-sep">•</span>

                            {/* Status label */}
                            {tx.status === 'completed' && (
                              <span className="status-label status-label-direct">
                                <CheckCircle2 size={11} strokeWidth={2} />
                                <span>Verified</span>
                              </span>
                            )}
                            {tx.status === 'transferring' && (
                              <span className="status-label status-label-active">
                                {tx.isWaitingForAck || tx.statusText === 'Slow receiver, waiting...'
                                  ? 'Slow receiver, waiting...'
                                  : `${isSelf ? 'Sending' : 'Receiving'} (${tx.progress || tx.percent || 0}%)`}
                              </span>
                            )}
                            {tx.status === 'queued' && (
                              <span className="status-label status-label-muted">
                                <Clock size={11} />
                                <span>Queued</span>
                              </span>
                            )}
                            {tx.status === 'interrupted' && (
                              <span className="status-label status-label-interrupted">
                                <AlertTriangle size={11} />
                                <span>Interrupted</span>
                              </span>
                            )}
                            {(tx.errorCode === 'RELAY_LIMIT_REACHED' || tx.errorMessage?.includes('Relay limit reached')) && (
                              <span className="status-label status-label-failed">
                                <AlertCircle size={11} />
                                <span>Relay limit reached</span>
                              </span>
                            )}
                            {(tx.status === 'failed' || tx.status === 'error') && tx.errorCode !== 'RELAY_LIMIT_REACHED' && !tx.errorMessage?.includes('Relay limit reached') && (
                              <span className="status-label status-label-failed">
                                <AlertCircle size={11} />
                                <span>Failed</span>
                              </span>
                            )}
                          </div>
                          {tx.errorMessage && (tx.status === 'failed' || tx.status === 'error' || tx.status === 'interrupted' || tx.errorCode === 'RELAY_LIMIT_REACHED') && (
                            <div className="transfer-error-text" style={{ fontSize: '11px', color: 'var(--color-status-error, #f87171)', marginTop: '4px' }}>
                              {tx.errorMessage}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="transfer-actions">
                          {tx.status === 'completed' && tx.downloadUrl && (
                            <a
                              href={tx.downloadUrl}
                              download={tx.fileName}
                              className="btn btn-primary btn-transfer-action"
                              aria-label={`Save ${tx.fileName}`}
                            >
                              <Download size={13} strokeWidth={2} />
                              <span>Save</span>
                            </a>
                          )}

                          {tx.status === 'transferring' && (
                            <button
                              type="button"
                              onClick={() => onCancelTransfer && onCancelTransfer(tx.transferId)}
                              className="btn btn-ghost btn-transfer-cancel"
                              aria-label="Cancel transfer"
                            >
                              <X size={14} />
                            </button>
                          )}

                          {(tx.status === 'interrupted' || tx.status === 'failed') && (
                            <button
                              type="button"
                              onClick={() => onRetryTransfer && onRetryTransfer(tx)}
                              className="btn btn-secondary btn-transfer-retry"
                              aria-label="Retry transfer"
                            >
                              <RotateCw size={12} strokeWidth={2} />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Active progress bar */}
                      {tx.status === 'transferring' && (
                        <div className="transfer-progress-block">
                          <div className="transfer-progress-track">
                            <div
                              className="transfer-progress-fill"
                              style={{ width: `${tx.progress || 0}%` }}
                            />
                          </div>
                          <div className="transfer-progress-stats">
                            <span className="mono-stat">
                              {formatBytes((tx.fileSize || 0) * ((tx.progress || 0) / 100))} / {formatBytes(tx.fileSize)}
                            </span>
                            <div className="transfer-speed-eta">
                              {tx.eta > 0 && <span className="mono-eta">{tx.eta}s left</span>}
                              {tx.speed > 0 && (
                                <span className="mono-speed">{formatBytes(tx.speed)}/s</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return null;
            })}

            <div ref={bottomAnchorRef} style={{ height: '1px' }} />
          </>
        )}
      </div>

      {/* Floating "New Items" scroll-to-bottom pill */}
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="floating-new-items-btn"
          aria-label={`Scroll to ${unreadCount} new items`}
        >
          <ArrowDown size={14} strokeWidth={2} />
          <span>New items ({unreadCount})</span>
        </button>
      )}
    </div>
  );
}
