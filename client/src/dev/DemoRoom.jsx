import React, { useState, useMemo } from 'react';
import { Room } from '../pages/Room.jsx';

/**
 * Synthetic mock data generator for dev & visual testing.
 * Only loaded when import.meta.env.DEV and URL has ?demo=1.
 * Never shipped in production bundle.
 */

const FILE_TYPES = [
  { ext: 'png', mime: 'image/png', type: 'image', size: 4200000 },
  { ext: 'pdf', mime: 'application/pdf', type: 'doc', size: 12500000 },
  { ext: 'zip', mime: 'application/zip', type: 'archive', size: 85000000 },
  { ext: 'mp4', mime: 'video/mp4', type: 'video', size: 240000000 },
  { ext: 'csv', mime: 'text/csv', type: 'doc', size: 850000 },
  { ext: 'fig', mime: 'application/octet-stream', type: 'code', size: 34000000 }
];

const SAMPLE_TEXTS = [
  'Hey! Just connected from Pixel 8 Pro.',
  'Here is the link to the design spec: https://linear.app/issue/DES-420',
  'Can you send over the latest high-res screenshots?',
  'Sending the full Figma export and camera raw files now.',
  'Got the first 3 files! Throughput looks great over direct Wi-Fi.',
  'Thanks! Let me know if the ZIP archive unpacks cleanly.',
  'Verified the SHA-256 hash on device, all bytes match.',
  'All good, closing session in a few minutes.'
];

export function generateMockTransfers(count = 60) {
  const transfers = [];
  const now = Date.now();

  for (let i = 1; i <= count; i++) {
    const ft = FILE_TYPES[i % FILE_TYPES.length];
    const isOutgoing = i % 2 === 1;
    let status = 'completed';
    let progress = 100;
    let speed = 0;
    let eta = 0;

    if (i === count) {
      status = 'transferring';
      progress = 68;
      speed = 14.8 * 1024 * 1024;
      eta = 4;
    } else if (i === count - 1) {
      status = 'transferring';
      progress = 24;
      speed = 11.2 * 1024 * 1024;
      eta = 18;
    } else if (i === count - 2) {
      status = 'queued';
      progress = 0;
    } else if (i === count - 3) {
      status = 'interrupted';
      progress = 42;
    } else if (i === count - 4) {
      status = 'failed';
      progress = 12;
    }

    transfers.push({
      transferId: `demo-transfer-${i}`,
      streamId: i,
      fileName: i % 7 === 0 
        ? `quarterly_financial_report_consolidated_balance_sheet_2026_audit_final_v${i}_confidential.${ft.ext}`
        : `Asset_Delivery_Package_0${i}.${ft.ext}`,
      fileSize: ft.size * (1 + (i % 5) * 0.4),
      fileType: ft.mime,
      direction: isOutgoing ? 'send' : 'receive',
      status,
      progress,
      speed,
      eta,
      createdAt: now - (count - i) * 8000,
      verified: status === 'completed',
      downloadUrl: status === 'completed' && !isOutgoing ? '#download-demo' : null,
      url: ft.type === 'image' ? 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80' : null
    });
  }

  return transfers;
}

export function generateMockMessages(count = 200) {
  const messages = [];
  const now = Date.now();

  for (let i = 1; i <= count; i++) {
    const isMe = i % 2 === 1;
    messages.push({
      id: `msg-${i}`,
      senderPeerId: isMe ? 'me-peer' : 'remote-peer',
      deviceName: isMe ? 'Windows PC' : 'Pixel 8 Pro',
      text: SAMPLE_TEXTS[i % SAMPLE_TEXTS.length] + (i % 8 === 0 ? ` [Message #${i}]` : ''),
      timestamp: now - (count - i) * 6000,
      isSelf: isMe
    });
  }

  return messages;
}

export default function DemoRoom() {
  const [scenario, setScenario] = useState(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '');
      if (hash) return hash;
    }
    return '60-transfers-200-messages';
  });

  const [isP2P, setIsP2P] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const scenarioData = useMemo(() => {
    switch (scenario) {
      case 'empty':
        return { transfers: [], messages: [] };
      case 'one-message':
        return {
          transfers: [],
          messages: [
            {
              id: 'msg-single',
              senderPeerId: 'remote-peer',
              deviceName: 'Pixel 8 Pro',
              text: 'Connected and ready! You can drop a file or type a message below.',
              timestamp: Date.now(),
              isSelf: false
            }
          ]
        };
      case '12-file-batch': {
        const now = Date.now();
        const batch = [];
        for (let i = 1; i <= 12; i++) {
          const ft = FILE_TYPES[i % FILE_TYPES.length];
          batch.push({
            transferId: `batch-file-${i}`,
            streamId: 100 + i,
            fileName: `Project_Asset_Batch_Item_${i}.${ft.ext}`,
            fileSize: 4500000 + i * 1200000,
            fileType: ft.mime,
            direction: 'send',
            status: i < 5 ? 'completed' : i === 5 ? 'transferring' : 'queued',
            progress: i < 5 ? 100 : i === 5 ? 54 : 0,
            speed: i === 5 ? 12.4 * 1024 * 1024 : 0,
            eta: i === 5 ? 6 : 0,
            createdAt: now - 15000 + i * 200, // all within seconds of each other
            verified: i < 5
          });
        }
        return {
          transfers: batch,
          messages: [
            {
              id: 'msg-batch-head',
              senderPeerId: 'me-peer',
              deviceName: 'Windows PC',
              text: 'Uploading the 12 design exports all at once.',
              timestamp: now - 16000,
              isSelf: true
            }
          ]
        };
      }
      case 'long-names': {
        const now = Date.now();
        return {
          transfers: [
            {
              transferId: 'long-1',
              streamId: 201,
              fileName: 'Quarterly_Financial_Review_Consolidated_Balance_Sheet_Audit_Q4_2026_Final_v12_Internal_Confidential_Signed_By_Auditor_Board.pdf',
              fileSize: 48500000,
              fileType: 'application/pdf',
              direction: 'send',
              status: 'transferring',
              progress: 42,
              speed: 9.6 * 1024 * 1024,
              eta: 3,
              createdAt: now - 30000
            },
            {
              transferId: 'long-2',
              streamId: 202,
              fileName: 'photo_with_super_unreasonably_long_filename_taken_on_the_highest_mountain_peak_in_the_rockies_during_sunrise_hdr_super_color_grading_full_res_8k.png',
              fileSize: 32000000,
              fileType: 'image/png',
              direction: 'receive',
              status: 'completed',
              progress: 100,
              verified: true,
              createdAt: now - 60000,
              url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80'
            }
          ],
          messages: [
            {
              id: 'msg-long-1',
              senderPeerId: 'me-peer',
              deviceName: 'Windows PC',
              text: 'Notice how the long filenames truncate gracefully in both the sidebar and the timeline without horizontal layout overflow.',
              timestamp: now - 20000,
              isSelf: true
            }
          ]
        };
      }
      case 'all-states': {
        const now = Date.now();
        return {
          transfers: [
            {
              transferId: 'state-queued',
              streamId: 301,
              fileName: 'Presentation_Pitch_Deck.pdf',
              fileSize: 18400000,
              fileType: 'application/pdf',
              direction: 'send',
              status: 'queued',
              progress: 0,
              createdAt: now - 50000
            },
            {
              transferId: 'state-sending',
              streamId: 302,
              fileName: 'Design_System_v2.fig',
              fileSize: 184200000,
              fileType: 'application/octet-stream',
              direction: 'send',
              status: 'transferring',
              progress: 68,
              speed: 14.8 * 1024 * 1024,
              eta: 4,
              createdAt: now - 40000
            },
            {
              transferId: 'state-verified',
              streamId: 303,
              fileName: 'Camera_Raw_084.png',
              fileSize: 14500000,
              fileType: 'image/png',
              direction: 'receive',
              status: 'completed',
              progress: 100,
              verified: true,
              createdAt: now - 30000,
              url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80'
            },
            {
              transferId: 'state-interrupted',
              streamId: 304,
              fileName: 'Keynote_Recording.mp4',
              fileSize: 320000000,
              fileType: 'video/mp4',
              direction: 'receive',
              status: 'interrupted',
              progress: 42,
              createdAt: now - 20000
            },
            {
              transferId: 'state-failed',
              streamId: 305,
              fileName: 'Database_Backup.dump',
              fileSize: 94000000,
              fileType: 'application/octet-stream',
              direction: 'send',
              status: 'failed',
              progress: 15,
              error: 'Connection interrupted',
              createdAt: now - 10000
            }
          ],
          messages: [
            {
              id: 'msg-states-info',
              senderPeerId: 'remote-peer',
              deviceName: 'Pixel 8 Pro',
              text: 'Testing all 5 transfer states simultaneously: Queued, Sending, Verified, Interrupted, and Failed.',
              timestamp: now - 8000,
              isSelf: false
            }
          ]
        };
      }
      case 'waiting':
        return {
          isWaiting: true,
          transfers: [],
          messages: []
        };
      case '60-transfers-200-messages':
      default:
        return {
          transfers: generateMockTransfers(60),
          messages: generateMockMessages(200)
        };
    }
  }, [scenario]);

  const SCENARIOS = [
    { id: '60-transfers-200-messages', label: '60 Files + 200 Msgs' },
    { id: '12-file-batch', label: '12 Batch' },
    { id: 'all-states', label: 'All States' },
    { id: 'long-names', label: 'Long Names' },
    { id: 'one-message', label: '1 Msg' },
    { id: 'empty', label: 'Empty' },
    { id: 'waiting', label: 'Waiting State' }
  ];

  return (
    <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Dev Switcher Toolbar */}
      <div
        id="demo-switcher"
        style={{
          flexShrink: 0,
          background: '#090d16',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          zIndex: 10000,
          fontSize: '11px',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <span style={{ color: '#22d3ee', fontWeight: 600, paddingRight: '4px' }}>DEMO FIXTURE:</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setScenario(s.id);
              if (typeof window !== 'undefined') window.location.hash = s.id;
            }}
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              border: scenario === s.id ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.12)',
              background: scenario === s.id ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.04)',
              color: scenario === s.id ? '#22d3ee' : '#94a3b8',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {s.label}
          </button>
        ))}

        <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

        {/* Relay vs Direct toggle */}
        <button
          type="button"
          onClick={() => setIsP2P((p) => !p)}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: isP2P ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
            color: isP2P ? '#34d399' : '#fbbf24',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          {isP2P ? 'Direct (LAN)' : 'Relay (server)'}
        </button>

        {/* Reconnecting toggle */}
        <button
          type="button"
          onClick={() => setIsReconnecting((r) => !r)}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: isReconnecting ? '1px solid #f43f5e' : '1px solid rgba(255,255,255,0.15)',
            background: isReconnecting ? 'rgba(244,63,94,0.2)' : 'rgba(255,255,255,0.04)',
            color: isReconnecting ? '#fb7185' : '#94a3b8',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          {isReconnecting ? 'Reconnecting: ON' : 'Reconnecting: OFF'}
        </button>
      </div>

      {/* Render Room Component with Mock Props */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <Room
          roomId="4291f86d381766ea7a16ba696581950c"
          joinToken="acdbf21948a14f6ae57ec0711045115f"
          roomStatus={scenarioData.isWaiting ? 'waiting' : 'connected'}
          isPeerReconnecting={isReconnecting}
          isOwner={true}
          myDeviceName="Windows PC"
          peerDeviceName="Pixel 8 Pro"
          expiresAt={Date.now() + 580000}
          messages={scenarioData.messages}
          transfers={scenarioData.transfers}
          isP2PConnected={isP2P}
          connectionType={isP2P ? 'lan' : 'relay'}
          connectionStats={{ rtt: 14 }}
          onSendMessage={(text) => console.log('DEMO onSendMessage:', text)}
          onFilesSelected={(files) => console.log('DEMO onFilesSelected:', files)}
          onRetryTransfer={(id) => console.log('DEMO onRetryTransfer:', id)}
          onCancelTransfer={(id) => console.log('DEMO onCancelTransfer:', id)}
          onClearCompleted={() => console.log('DEMO onClearCompleted')}
          onLeaveRoom={() => console.log('DEMO onLeaveRoom')}
          onCloseRoom={() => console.log('DEMO onCloseRoom')}
          onReset={() => console.log('DEMO onReset')}
          onStartFreshSession={() => console.log('DEMO onStartFreshSession')}
        />
      </div>
    </div>
  );
}
