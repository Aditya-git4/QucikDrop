import { useState, useEffect, useRef, useCallback } from 'react';
import { PeerConnectionManager } from '../services/peerConnection.js';
import { playConnectSound, playMessageSound, hapticSuccess, hapticTap } from '../utils/soundEffects.js';
import { isRelayModeEnabled, debugLogger } from '../utils/debugLogger.js';

/**
 * useWebRTC manages RTCPeerConnection negotiation, ICE signaling via WebSocket,
 * direct DataChannel communication, and connection type monitoring (STUN direct vs TURN relay).
 * @param {{
 *   signalingClient: import('../services/signalingClient.js').SignalingClient | null,
 *   isOwner: boolean,
 *   roomId: string | null,
 *   myDeviceName: string,
 *   peerDeviceName: string | null,
 *   iceServers?: Array<any> | null
 * }} props
 */
export function useWebRTC({
  signalingClient,
  isOwner,
  roomId,
  myDeviceName,
  peerDeviceName,
  iceServers = null
}) {
  const isRelayOnly = isRelayModeEnabled();
  const [webrtcStatus, setWebrtcStatus] = useState(isRelayOnly ? 'disabled (relay-only)' : 'disconnected');
  const [isP2PConnected, setIsP2PConnected] = useState(false);
  const [connectionType, setConnectionType] = useState(isRelayOnly ? 'relay' : 'unknown');
  const [connectionStats, setConnectionStats] = useState(null);
  const [p2pMessages, setP2pMessages] = useState([]);
  const seenMessageIdsRef = useRef(new Set());

  const isOwnerRef = useRef(isOwner);
  const peerDeviceNameRef = useRef(peerDeviceName);
  const myDeviceNameRef = useRef(myDeviceName);

  useEffect(() => {
    isOwnerRef.current = isOwner;
  }, [isOwner]);

  useEffect(() => {
    peerDeviceNameRef.current = peerDeviceName;
  }, [peerDeviceName]);

  useEffect(() => {
    myDeviceNameRef.current = myDeviceName;
  }, [myDeviceName]);

  const pcManagerRef = useRef(null);

  if (!pcManagerRef.current) {
    pcManagerRef.current = new PeerConnectionManager({
      iceServers: iceServers || undefined
    });
  }

  const pcManager = pcManagerRef.current;

  // Dynamically update ICE servers when received from signaling server
  useEffect(() => {
    if (iceServers && pcManager) {
      pcManager.setIceServers(iceServers);
    }
  }, [iceServers, pcManager]);

  useEffect(() => {
    if (!signalingClient) return;

    if (isRelayOnly) {
      debugLogger.logStateChange('WEBRTC', 'relay_mode_active', { note: 'RTCPeerConnection completely disabled via ?relay=1' });

      const handleSignalingTextMessage = (msg) => {
        if (msg && msg.text) {
          if (msg.clientMessageId) {
            if (seenMessageIdsRef.current.has(msg.clientMessageId)) return;
            seenMessageIdsRef.current.add(msg.clientMessageId);
          }

          playMessageSound();
          hapticTap();
          setP2pMessages((prev) => {
            if (prev.some((m) => m.id === msg.clientMessageId)) return prev;
            return [
              ...prev,
              {
                id: msg.clientMessageId || `${Date.now()}-${Math.random()}`,
                text: msg.text,
                deviceName: msg.deviceName || peerDeviceNameRef.current || 'Remote Peer',
                sentAt: msg.sentAt || Date.now(),
                isMine: false,
                isRelayed: true
              }
            ];
          });
        }
      };

      signalingClient.on('textMessage', handleSignalingTextMessage);

      return () => {
        signalingClient.off('textMessage', handleSignalingTextMessage);
      };
    }

    // 1. ICE Candidate generation -> send to peer via signaling server
    const handleLocalIceCandidate = (candidate) => {
      try {
        signalingClient.send({
          type: 'rtc:ice-candidate',
          version: 1,
          payload: candidate
        });
      } catch (err) {
        console.warn('Failed to send ICE candidate:', err);
      }
    };

    // 2. Peer connection status change
    const handleStatusChange = (status) => {
      if (status === 'connected') {
        setWebrtcStatus('connected');
        if (
          pcManager.isP2PHealthy &&
          pcManager.controlChannel?.readyState === 'open' &&
          pcManager.fileChannel?.readyState === 'open' &&
          pcManager.pc?.connectionState === 'connected'
        ) {
          setIsP2PConnected(true);
        }
      } else if (['failed', 'disconnected', 'closed'].includes(status)) {
        setWebrtcStatus(status);
        setIsP2PConnected(false);
        setConnectionType('relay');
        setConnectionStats(null);
      }
    };

    const handleHealthChange = (isHealthy) => {
      if (!isHealthy) {
        setIsP2PConnected(false);
        setConnectionType('relay');
      } else if (
        pcManager.controlChannel?.readyState === 'open' &&
        pcManager.fileChannel?.readyState === 'open' &&
        pcManager.pc?.connectionState === 'connected'
      ) {
        setIsP2PConnected(true);
        if (pcManager.connectionType && pcManager.connectionType !== 'unknown') {
          setConnectionType(pcManager.connectionType);
        } else {
          setConnectionType('direct');
        }
      }
    };

    // 3. DataChannels ready
    const handleReady = () => {
      if (
        pcManager.isP2PHealthy &&
        pcManager.controlChannel?.readyState === 'open' &&
        pcManager.fileChannel?.readyState === 'open' &&
        pcManager.pc?.connectionState === 'connected'
      ) {
        setWebrtcStatus('connected');
        setIsP2PConnected(true);
        if (pcManager.connectionType && pcManager.connectionType !== 'unknown') {
          setConnectionType(pcManager.connectionType);
        } else {
          setConnectionType('direct');
        }
        playConnectSound();
        hapticSuccess();
      }
    };

    // 4. Connection type and stats monitoring
    const handleConnectionType = (type) => {
      setConnectionType(type);
    };

    const handleConnectionStats = (stats) => {
      setConnectionStats(stats);
      if (stats?.connectionType) {
        setConnectionType(stats.connectionType);
      }
    };

    // 5. Incoming P2P chat messages over control DataChannel
    const handleControlMessage = (msg) => {
      if (msg && msg.type === 'chat') {
        if (msg.clientMessageId) {
          if (seenMessageIdsRef.current.has(msg.clientMessageId)) return;
          seenMessageIdsRef.current.add(msg.clientMessageId);
        }

        playMessageSound();
        hapticTap();
        setP2pMessages((prev) => [
          ...prev,
          {
            id: msg.clientMessageId || `${Date.now()}-${Math.random()}`,
            text: msg.text,
            deviceName: msg.deviceName || peerDeviceNameRef.current || 'Remote Peer',
            sentAt: msg.sentAt || Date.now(),
            isMine: false
          }
        ]);
      }
    };

    pcManager.on('iceCandidate', handleLocalIceCandidate);
    pcManager.on('statusChange', handleStatusChange);
    pcManager.on('ready', handleReady);
    pcManager.on('connectionType', handleConnectionType);
    pcManager.on('connectionStats', handleConnectionStats);
    pcManager.on('controlMessage', handleControlMessage);
    pcManager.on('healthChange', handleHealthChange);

    // 5. Host initiates offer when Guest joins
    const handlePeerJoined = async () => {
      if (isOwnerRef.current) {
        setWebrtcStatus('connecting');
        try {
          const offer = await pcManager.createOffer();
          signalingClient.send({
            type: 'rtc:offer',
            version: 1,
            payload: offer
          });
        } catch (err) {
          console.error('Failed to create WebRTC offer:', err);
          setWebrtcStatus('failed');
        }
      }
    };

    const handlePeerReconnected = async () => {
      if (isOwnerRef.current) {
        if (!isP2PConnected || pcManager.pc?.connectionState === 'failed' || !pcManager.isP2PHealthy) {
          setWebrtcStatus('connecting');
          try {
            const offer = await pcManager.createOffer();
            signalingClient.send({
              type: 'rtc:offer',
              version: 1,
              payload: offer
            });
          } catch (err) {
            console.error('Failed to recreate WebRTC offer on peer reconnect:', err);
          }
        }
      }
    };

    // 6. Guest receives offer -> generates and sends answer
    const handleOffer = async (msg) => {
      if (!isOwnerRef.current) {
        setWebrtcStatus('connecting');
        try {
          const answer = await pcManager.handleOffer(msg.payload);
          signalingClient.send({
            type: 'rtc:answer',
            version: 1,
            payload: answer
          });
        } catch (err) {
          console.error('Failed to handle WebRTC offer:', err);
          setWebrtcStatus('failed');
        }
      }
    };

    // 7. Host receives answer
    const handleAnswer = async (msg) => {
      if (isOwnerRef.current) {
        try {
          await pcManager.handleAnswer(msg.payload);
        } catch (err) {
          console.error('Failed to handle WebRTC answer:', err);
        }
      }
    };

    // 8. Remote ICE candidate arrived
    const handleRemoteIceCandidate = async (msg) => {
      if (msg.payload) {
        await pcManager.addIceCandidate(msg.payload);
      }
    };

    // 9. Incoming text messages via signaling WebSocket fallback
    const handleSignalingTextMessage = (msg) => {
      if (msg && msg.text) {
        if (msg.clientMessageId) {
          if (seenMessageIdsRef.current.has(msg.clientMessageId)) return;
          seenMessageIdsRef.current.add(msg.clientMessageId);
        }

        playMessageSound();
        hapticTap();
        setP2pMessages((prev) => {
          if (prev.some((m) => m.id === msg.clientMessageId)) return prev;
          return [
            ...prev,
            {
              id: msg.clientMessageId || `${Date.now()}-${Math.random()}`,
              text: msg.text,
              deviceName: msg.deviceName || peerDeviceNameRef.current || 'Remote Peer',
              sentAt: msg.sentAt || Date.now(),
              isMine: false,
              isRelayed: true
            }
          ];
        });
      }
    };

    signalingClient.on('peerJoined', handlePeerJoined);
    signalingClient.on('peerReconnected', handlePeerReconnected);
    signalingClient.on('rtc:offer', handleOffer);
    signalingClient.on('rtc:answer', handleAnswer);
    signalingClient.on('rtc:ice-candidate', handleRemoteIceCandidate);
    signalingClient.on('textMessage', handleSignalingTextMessage);

    return () => {
      pcManager.off('iceCandidate', handleLocalIceCandidate);
      pcManager.off('statusChange', handleStatusChange);
      pcManager.off('ready', handleReady);
      pcManager.off('connectionType', handleConnectionType);
      pcManager.off('connectionStats', handleConnectionStats);
      pcManager.off('controlMessage', handleControlMessage);
      pcManager.off('healthChange', handleHealthChange);

      signalingClient.off('peerJoined', handlePeerJoined);
      signalingClient.off('peerReconnected', handlePeerReconnected);
      signalingClient.off('rtc:offer', handleOffer);
      signalingClient.off('rtc:answer', handleAnswer);
      signalingClient.off('rtc:ice-candidate', handleRemoteIceCandidate);
      signalingClient.off('textMessage', handleSignalingTextMessage);

      pcManager.close();
      setIsP2PConnected(false);
      setWebrtcStatus('disconnected');
      setConnectionType('unknown');
      setConnectionStats(null);
    };
  }, [signalingClient, pcManager]);

  /** Send chat text directly over WebRTC control channel or signaling WebSocket fallback */
  const sendP2PText = useCallback((text) => {
    if (!text || !text.trim()) return;

    const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const trimmed = text.trim();

    let delivered = false;

    // 1. Try P2P DataChannel if connected and healthy
    const isDcReady =
      isP2PConnected &&
      pcManager?.isP2PHealthy &&
      pcManager?.controlChannel?.readyState === 'open' &&
      pcManager?.fileChannel?.readyState === 'open' &&
      pcManager?.pc?.connectionState === 'connected';

    if (isDcReady) {
      try {
        const payload = {
          type: 'chat',
          clientMessageId,
          text: trimmed,
          deviceName: myDeviceName,
          sentAt: now
        };
        pcManager.sendControl(payload);
        delivered = true;

        // Expect app-level ack over the DataChannel within 2 seconds
        let ackReceived = false;
        const ackTimeout = setTimeout(() => {
          pcManager.off('controlMessage', onAck);
          if (!ackReceived) {
            console.warn(`No chat:ack received for ${clientMessageId} within 2s. Resending via WebSocket and marking P2P unhealthy.`);
            debugLogger.logStateChange('WEBRTC', 'chat_ack_timeout', { clientMessageId }, pcManager, signalingClient);
            pcManager.markP2PUnhealthy('chat_ack_timeout_2s');

            if (signalingClient && signalingClient.isConnected) {
              try {
                signalingClient.sendTextMessage(trimmed, clientMessageId);
              } catch (err) {
                console.warn('Signaling resend error:', err);
              }
            }
          }
        }, 2000);

        const onAck = (msg) => {
          if (msg?.type === 'chat:ack' && msg.clientMessageId === clientMessageId) {
            ackReceived = true;
            clearTimeout(ackTimeout);
            pcManager.off('controlMessage', onAck);
          }
        };

        pcManager.on('controlMessage', onAck);
      } catch (err) {
        console.warn('P2P control send failed, falling back to signaling:', err);
      }
    }

    // 2. Fallback to WebSocket signaling relay
    if (!delivered && signalingClient && signalingClient.isConnected) {
      try {
        signalingClient.sendTextMessage(trimmed, clientMessageId);
        delivered = true;
      } catch (err) {
        console.warn('Signaling text send error:', err);
      }
    }

    // Append to local view
    setP2pMessages((prev) => [
      ...prev,
      {
        id: clientMessageId,
        text: trimmed,
        deviceName: myDeviceName,
        sentAt: now,
        isMine: true
      }
    ]);
  }, [isP2PConnected, myDeviceName, pcManager, signalingClient]);

  /** Teardown and reset all WebRTC peer connection resources and messages */
  const resetWebRTC = useCallback(() => {
    if (pcManagerRef.current) {
      pcManagerRef.current.close();
    }
    pcManagerRef.current = new PeerConnectionManager({
      iceServers: iceServers || undefined
    });
    setWebrtcStatus(isRelayOnly ? 'disabled (relay-only)' : 'disconnected');
    setIsP2PConnected(false);
    setConnectionType(isRelayOnly ? 'relay' : 'unknown');
    setConnectionStats(null);
    setP2pMessages([]);
    seenMessageIdsRef.current.clear();
  }, [isRelayOnly, iceServers]);

  return {
    webrtcStatus,
    isP2PConnected,
    connectionType,
    connectionStats,
    isRelayed: connectionType === 'relay',
    peerConnection: pcManager,
    p2pMessages,
    sendP2PText,
    resetWebRTC
  };
}
