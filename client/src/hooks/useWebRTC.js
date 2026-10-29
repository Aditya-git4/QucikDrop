import { useState, useEffect, useRef, useCallback } from 'react';
import { PeerConnectionManager } from '../services/peerConnection.js';
import { playConnectSound, playMessageSound, hapticSuccess, hapticTap } from '../utils/soundEffects.js';

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
  const [webrtcStatus, setWebrtcStatus] = useState('disconnected'); // disconnected, connecting, connected, failed
  const [isP2PConnected, setIsP2PConnected] = useState(false);
  const [connectionType, setConnectionType] = useState('unknown'); // 'unknown' | 'lan' | 'direct' | 'relay'
  const [connectionStats, setConnectionStats] = useState(null);
  const [p2pMessages, setP2pMessages] = useState([]);

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
      if (status === 'connected' || status === 'completed') {
        setWebrtcStatus('connected');
        if (
          pcManager.controlChannel?.readyState === 'open' ||
          pcManager.fileChannel?.readyState === 'open'
        ) {
          setIsP2PConnected(true);
        }
      } else if (status === 'failed') {
        setWebrtcStatus('failed');
        setIsP2PConnected(false);
        setConnectionType('unknown');
        setConnectionStats(null);
      } else if (status === 'disconnected' || status === 'closed') {
        if (
          pcManager.controlChannel?.readyState !== 'open' &&
          pcManager.fileChannel?.readyState !== 'open'
        ) {
          setWebrtcStatus('disconnected');
          setIsP2PConnected(false);
          setConnectionType('unknown');
          setConnectionStats(null);
        }
      }
    };

    // 3. DataChannels ready
    const handleReady = () => {
      setWebrtcStatus('connected');
      setIsP2PConnected(true);
      playConnectSound();
      hapticSuccess();
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

      signalingClient.off('peerJoined', handlePeerJoined);
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

    // 1. Try P2P DataChannel if connected
    if (isP2PConnected && pcManager?.controlChannel?.readyState === 'open') {
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

  return {
    webrtcStatus,
    isP2PConnected,
    connectionType,
    connectionStats,
    isRelayed: connectionType === 'relay',
    peerConnection: pcManager,
    p2pMessages,
    sendP2PText
  };
}
