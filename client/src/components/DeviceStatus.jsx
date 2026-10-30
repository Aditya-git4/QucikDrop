import React from 'react';
import { Laptop, Smartphone, ArrowLeftRight, Zap, RefreshCw } from 'lucide-react';

/**
 * Modern Device Pair Strip.
 * Shows "You (Device Name)" <-> "Peer (Peer Name)" with live connection pill.
 * Zero emojis, clean styling.
 * @param {{
 *   myDeviceName: string,
 *   peerDeviceName: string,
 *   isOwner: boolean,
 *   isConnected: boolean,
 *   isPeerReconnecting?: boolean,
 *   isP2PConnected?: boolean,
 *   connectionType?: string,
 *   connectionStats?: any
 * }} props
 */
export function DeviceStatus({
  myDeviceName,
  peerDeviceName,
  isOwner,
  isConnected,
  isPeerReconnecting = false,
  isP2PConnected = false,
  connectionType = 'unknown',
  connectionStats = null
}) {
  const getBadgeConfig = () => {
    if (isPeerReconnecting) {
      return {
        text: 'Reconnecting...',
        color: 'var(--color-status-relay)',
        bg: 'var(--color-status-relay-bg)',
        border: 'var(--color-status-relay-border)',
        icon: RefreshCw,
        spin: true
      };
    }
    if (isP2PConnected) {
      if (connectionType === 'relay') {
        return {
          text: 'Via TURN',
          color: '#38bdf8',
          bg: 'rgba(56, 189, 248, 0.12)',
          border: 'rgba(56, 189, 248, 0.3)',
          icon: Zap,
          spin: false
        };
      }
      return {
        text: 'Direct',
        color: 'var(--color-status-direct)',
        bg: 'var(--color-status-direct-bg)',
        border: 'var(--color-status-direct-border)',
        icon: Zap,
        spin: false
      };
    }
    if (isConnected) {
      return {
        text: 'Server relay',
        color: 'var(--color-status-relay)',
        bg: 'var(--color-status-relay-bg)',
        border: 'var(--color-status-relay-border)',
        icon: null,
        spin: false
      };
    }
    return {
      text: 'Waiting for peer',
      color: 'var(--color-text-muted)',
      bg: 'var(--color-bg-surface-2)',
      border: 'var(--border-subtle)',
      icon: null,
      spin: false
    };
  };

  const badge = getBadgeConfig();
  const BadgeIcon = badge.icon;

  return (
    <div
      className="device-pair-strip"
      style={{
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '14px',
        background: 'var(--color-bg-surface-1)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)'
      }}
    >
      {/* Local Device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6366f1',
            flexShrink: 0
          }}
        >
          <Laptop size={18} strokeWidth={1.75} />
        </div>
        <div>
          <div
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            {isOwner ? 'Host (You)' : 'Guest (You)'}
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              maxWidth: '160px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {myDeviceName || 'This Device'}
          </div>
        </div>
      </div>

      {/* Connection Bridge Indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flex: '1 1 200px',
          justifyContent: 'center'
        }}
      >
        <div style={{ height: '1px', flex: 1, background: 'var(--border-subtle)' }} />

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: badge.bg,
            border: `1px solid ${badge.border}`,
            color: badge.color,
            fontSize: 'var(--font-size-xs)',
            fontWeight: 500
          }}
        >
          {BadgeIcon && (
            <BadgeIcon
              size={12}
              strokeWidth={2}
              style={{
                animation: badge.spin ? 'spin 1.5s linear infinite' : 'none'
              }}
            />
          )}
          <span>{badge.text}</span>
        </div>

        <div style={{ height: '1px', flex: 1, background: 'var(--border-subtle)' }} />
      </div>

      {/* Peer Device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            {isOwner ? 'Guest' : 'Host'}
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              color: peerDeviceName ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              maxWidth: '160px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {peerDeviceName || (isConnected ? 'Connected Peer' : 'Waiting to join')}
          </div>
        </div>

        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: peerDeviceName ? '#22d3ee' : 'var(--color-text-muted)',
            flexShrink: 0
          }}
        >
          <Smartphone size={18} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}
