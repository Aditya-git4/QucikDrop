import { useState, useEffect, useRef, useCallback } from 'react';
import { SignalingClient } from '../services/signalingClient.js';
import { getWebSocketUrl, getDeviceDefaultName } from '../utils/roomUtils.js';

export function useSignaling() {
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected, connecting, connected
  const [roomStatus, setRoomStatus] = useState('idle'); // idle, waiting, connected, closed, expired, error
  const [roomId, setRoomId] = useState(null);
  const [joinToken, setJoinToken] = useState(null);
  const [peerId, setPeerId] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [myDeviceName, setMyDeviceName] = useState(() => getDeviceDefaultName());
  const [peerDeviceName, setPeerDeviceName] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [messages, setMessages] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  const clientRef = useRef(null);

  // Initialize client singleton
  if (!clientRef.current) {
    clientRef.current = new SignalingClient();
  }

  const client = clientRef.current;

  // Set up event listeners
  useEffect(() => {
    const handleConnected = () => {
      setConnectionStatus('connected');
    };

    const handleDisconnected = () => {
      setConnectionStatus('disconnected');
    };

    const handleReconnecting = () => {
      setConnectionStatus('connecting');
    };

    const handleRoomCreated = (msg) => {
      setRoomStatus('waiting');
      setRoomId(msg.roomId);
      setJoinToken(msg.joinToken);
      setPeerId(msg.peerId);
      setIsOwner(true);
      setExpiresAt(msg.expiresAt);
      setErrorMessage(null);
    };

    const handleRoomJoined = (msg) => {
      setRoomStatus('connected');
      setRoomId(msg.roomId);
      setPeerId(msg.peerId);
      setIsOwner(false);
      setPeerDeviceName(msg.ownerDeviceName || 'Host Device');
      setErrorMessage(null);
    };

    const handlePeerJoined = (msg) => {
      setRoomStatus('connected');
      setPeerDeviceName(msg.deviceName || 'Guest Device');
    };

    const handlePeerLeft = () => {
      setRoomStatus('closed');
      setErrorMessage('The other device has left the room. The room has been closed.');
    };

    const handleTextMessage = (msg) => {
      setMessages((prev) => [
        ...prev,
        {
          id: msg.clientMessageId || `${Date.now()}-${Math.random()}`,
          text: msg.text,
          senderPeerId: msg.senderPeerId,
          deviceName: msg.deviceName,
          sentAt: msg.sentAt || Date.now(),
          isMine: false
        }
      ]);
    };

    const handleRoomClosed = (msg) => {
      setRoomStatus('closed');
      const reasonText = msg.reason === 'closed_by_owner' 
        ? 'The room owner closed this room.' 
        : 'The room has been closed.';
      setErrorMessage(reasonText);
    };

    const handleRoomExpired = () => {
      setRoomStatus('expired');
      setErrorMessage('This temporary room has expired.');
    };

    const handleRoomError = (msg) => {
      setErrorCode(msg.code);
      setErrorMessage(msg.message || 'An error occurred.');
      if (['INVALID_ROOM', 'INVALID_TOKEN', 'ROOM_EXPIRED', 'ROOM_FULL', 'TOKEN_USED'].includes(msg.code)) {
        setRoomStatus('error');
      }
    };

    client.on('connected', handleConnected);
    client.on('disconnected', handleDisconnected);
    client.on('reconnecting', handleReconnecting);
    client.on('roomCreated', handleRoomCreated);
    client.on('roomJoined', handleRoomJoined);
    client.on('peerJoined', handlePeerJoined);
    client.on('peerLeft', handlePeerLeft);
    client.on('textMessage', handleTextMessage);
    client.on('roomClosed', handleRoomClosed);
    client.on('roomExpired', handleRoomExpired);
    client.on('roomError', handleRoomError);

    return () => {
      client.disconnect();
    };
  }, [client]);

  /** Ensure WebSocket is connected before sending action */
  const ensureConnected = useCallback(async () => {
    if (client.isConnected) return;
    setConnectionStatus('connecting');
    const wsUrl = getWebSocketUrl();
    await client.connect(wsUrl);
  }, [client]);

  /** Create a new room */
  const createRoom = useCallback(async (deviceName) => {
    try {
      const name = deviceName || myDeviceName;
      setMyDeviceName(name);
      setErrorMessage(null);
      setErrorCode(null);
      await ensureConnected();
      client.createRoom(name);
    } catch (err) {
      setRoomStatus('error');
      setErrorMessage(err.message || 'Failed to connect to signaling server');
    }
  }, [client, myDeviceName, ensureConnected]);

  /** Join an existing room */
  const joinRoom = useCallback(async (targetRoomId, targetJoinToken, deviceName) => {
    try {
      const name = deviceName || myDeviceName;
      setMyDeviceName(name);
      setErrorMessage(null);
      setErrorCode(null);
      await ensureConnected();
      client.joinRoom(targetRoomId, targetJoinToken, name);
    } catch (err) {
      setRoomStatus('error');
      setErrorMessage(err.message || 'Failed to connect to signaling server');
    }
  }, [client, myDeviceName, ensureConnected]);

  /** Send a text message */
  const sendMessage = useCallback((text) => {
    if (!text || !text.trim()) return;
    const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      client.sendTextMessage(text, clientMessageId);
      // Optimistically append to sender's session view
      setMessages((prev) => [
        ...prev,
        {
          id: clientMessageId,
          text,
          senderPeerId: peerId,
          deviceName: myDeviceName,
          sentAt: Date.now(),
          isMine: true
        }
      ]);
    } catch (err) {
      setErrorMessage('Failed to send text message: ' + err.message);
    }
  }, [client, peerId, myDeviceName]);

  /** Close the room */
  const closeRoom = useCallback(() => {
    try {
      client.closeRoom();
    } catch {
      // ignore
    }
    setRoomStatus('closed');
  }, [client]);

  /** Reset all room state */
  const reset = useCallback(() => {
    client.disconnect();
    setRoomStatus('idle');
    setRoomId(null);
    setJoinToken(null);
    setPeerId(null);
    setIsOwner(false);
    setPeerDeviceName(null);
    setExpiresAt(null);
    setMessages([]);
    setErrorMessage(null);
    setErrorCode(null);
  }, [client]);

  return {
    signalingClient: client,
    connectionStatus,
    roomStatus,
    roomId,
    joinToken,
    peerId,
    isOwner,
    myDeviceName,
    peerDeviceName,
    expiresAt,
    messages,
    errorMessage,
    errorCode,
    createRoom,
    joinRoom,
    sendMessage,
    closeRoom,
    reset,
    setMyDeviceName
  };
}
