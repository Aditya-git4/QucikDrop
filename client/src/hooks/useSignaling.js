import { useState, useEffect, useRef, useCallback } from 'react';
import { SignalingClient } from '../services/signalingClient.js';
import {
  getWebSocketUrl,
  getDeviceDefaultName,
  saveRoomSession,
  getRoomSession,
  clearRoomSession
} from '../utils/roomUtils.js';
import { generateRoomKey } from '../utils/relayCrypto.js';

export function useSignaling() {
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // disconnected, connecting, connected
  const [roomStatus, setRoomStatus] = useState('idle'); // idle, waiting, connecting, pending_approval, waiting_pin, connected, denied, closed, expired, error
  const [isPeerReconnecting, setIsPeerReconnecting] = useState(false);
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
  const [iceServers, setIceServers] = useState(null);
  const [roomKey, setRoomKey] = useState(null);

  // Host approval state
  const [pendingJoinRequest, setPendingJoinRequest] = useState(null); // { requestId, deviceName, userAgent }

  // Joiner approval & PIN state
  const [isJoinPending, setIsJoinPending] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState(null);
  const [requirePin, setRequirePin] = useState(false);
  const [roomPin, setRoomPin] = useState(null);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinError, setPinError] = useState(null);
  const [pinAttemptsRemaining, setPinAttemptsRemaining] = useState(null);
  const [joinDenied, setJoinDenied] = useState(false);

  const clientRef = useRef(null);
  const roomKeyRef = useRef(null);

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
      setIceServers(msg.iceServers || null);
      setErrorMessage(null);
      setIsPeerReconnecting(false);
      setRequirePin(Boolean(msg.requirePin));
      setRoomPin(msg.pin || null);

      if (msg.peerSecret) {
        const session = {
          roomId: msg.roomId,
          peerId: msg.peerId,
          peerSecret: msg.peerSecret,
          isOwner: true,
          deviceName: myDeviceName,
          roomKey: roomKeyRef.current
        };
        client.setActiveSession(session);
        saveRoomSession(msg.roomId, session);
      }
    };

    const handleRoomJoined = (msg) => {
      setRoomStatus('connected');
      setRoomId(msg.roomId);
      setPeerId(msg.peerId);
      setIsOwner(false);
      setPeerDeviceName(msg.ownerDeviceName || 'Host Device');
      setIceServers(msg.iceServers || null);
      setErrorMessage(null);
      setIsPeerReconnecting(false);
      setIsJoinPending(false);
      setPendingRequestId(null);
      setPinRequired(false);
      setPinError(null);
      setPinAttemptsRemaining(null);
      setJoinDenied(false);

      if (msg.peerSecret) {
        const session = {
          roomId: msg.roomId,
          peerId: msg.peerId,
          peerSecret: msg.peerSecret,
          isOwner: false,
          deviceName: myDeviceName,
          roomKey: roomKeyRef.current
        };
        client.setActiveSession(session);
        saveRoomSession(msg.roomId, session);
      }
    };

    const handleRoomRejoined = (msg) => {
      setRoomStatus(msg.status || 'connected');
      setRoomId(msg.roomId);
      setPeerId(msg.peerId);
      setPeerDeviceName(msg.peerDeviceName || 'Remote Peer');
      setIceServers(msg.iceServers || null);
      setErrorMessage(null);
      setIsPeerReconnecting(false);
      setIsJoinPending(false);
      setPendingRequestId(null);
      const stored = getRoomSession(msg.roomId);
      if (stored?.roomKey) {
        roomKeyRef.current = stored.roomKey;
        setRoomKey(stored.roomKey);
      }
    };

    const handlePeerJoined = (msg) => {
      setRoomStatus('connected');
      setPeerDeviceName(msg.deviceName || 'Guest Device');
      setIsPeerReconnecting(false);
      setPendingJoinRequest(null);
    };

    const handleRoomJoinPending = (msg) => {
      setIsJoinPending(true);
      setPendingRequestId(msg.requestId || null);
      setPinRequired(false);
      setPinError(null);
      setRoomStatus('pending_approval');
    };

    const handlePeerJoinRequest = (msg) => {
      setPendingJoinRequest({
        requestId: msg.requestId,
        deviceName: msg.deviceName || 'Unknown device',
        userAgent: msg.userAgent || 'Web browser'
      });
    };

    const handlePeerJoinCanceled = () => {
      setPendingJoinRequest(null);
    };

    const handlePeerJoinTimedOut = () => {
      setPendingJoinRequest(null);
    };

    const handlePeerDisconnected = () => {
      // Peer temporarily disconnected -> enter grace period without error
      setIsPeerReconnecting(true);
    };

    const handlePeerReconnected = (msg) => {
      setIsPeerReconnecting(false);
      if (msg?.deviceName) {
        setPeerDeviceName(msg.deviceName);
      }
    };

    const handlePeerLeft = () => {
      setIsPeerReconnecting(false);
      setRoomStatus('closed');
      setErrorMessage('The other device has left the room. The room has been closed.');
      if (roomId) clearRoomSession(roomId);
      client.clearActiveSession();
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
      setIsPeerReconnecting(false);
      setRoomStatus('closed');
      const reasonText = msg.reason === 'closed_by_owner' 
        ? 'The room owner closed this room.' 
        : msg.reason === 'guest_left'
        ? 'The other device has left the room.'
        : msg.reason === 'peer_timeout'
        ? 'The other device disconnected and did not reconnect within the grace period.'
        : 'The room has been closed.';
      setErrorMessage(reasonText);
      if (roomId) clearRoomSession(roomId);
      client.clearActiveSession();
    };

    const handleRoomExpired = () => {
      setIsPeerReconnecting(false);
      setRoomStatus('expired');
      setErrorMessage('This temporary room has expired.');
      if (roomId) clearRoomSession(roomId);
      client.clearActiveSession();
    };

    const handleRoomError = (msg) => {
      // PEER_SLOW is an internal relay backpressure signal, not a room-level error
      if (msg?.code === 'PEER_SLOW') {
        return;
      }
      if (msg?.code === 'PIN_REQUIRED') {
        setPinRequired(true);
        setPinError(null);
        setRoomStatus('waiting_pin');
        return;
      }
      if (msg?.code === 'INVALID_PIN') {
        setPinRequired(true);
        setPinError(msg.message || 'Incorrect PIN');
        setPinAttemptsRemaining(msg.attemptsRemaining ?? null);
        setRoomStatus('waiting_pin');
        return;
      }
      if (msg?.code === 'JOIN_DENIED') {
        setIsJoinPending(false);
        setPendingRequestId(null);
        setJoinDenied(true);
        setRoomStatus('denied');
        setErrorMessage(msg.message || 'Join request was declined by the host.');
        return;
      }
      if (msg?.code === 'TOO_MANY_ATTEMPTS') {
        setIsJoinPending(false);
        setPendingRequestId(null);
        setPinRequired(false);
        setRoomStatus('closed');
        setErrorMessage(msg.message || 'Too many attempts. Room has been closed for security.');
        const targetSessionRoomId = client.activeSession?.roomId || roomId;
        clearRoomSession(targetSessionRoomId);
        client.clearActiveSession();
        return;
      }
      setErrorCode(msg.code);
      setErrorMessage(msg.message || 'An error occurred.');
      if (['INVALID_ROOM', 'INVALID_TOKEN', 'INVALID_REJOIN', 'ROOM_EXPIRED', 'ROOM_FULL', 'TOKEN_USED'].includes(msg.code)) {
        setRoomStatus('error');
        const targetSessionRoomId = client.activeSession?.roomId || roomId;
        clearRoomSession(targetSessionRoomId);
        client.clearActiveSession();
      }
    };

    client.on('connected', handleConnected);
    client.on('disconnected', handleDisconnected);
    client.on('reconnecting', handleReconnecting);
    client.on('roomCreated', handleRoomCreated);
    client.on('roomJoined', handleRoomJoined);
    client.on('roomRejoined', handleRoomRejoined);
    client.on('peerJoined', handlePeerJoined);
    client.on('peerDisconnected', handlePeerDisconnected);
    client.on('peerReconnected', handlePeerReconnected);
    client.on('peerLeft', handlePeerLeft);
    client.on('roomJoinPending', handleRoomJoinPending);
    client.on('peerJoinRequest', handlePeerJoinRequest);
    client.on('peerJoinCanceled', handlePeerJoinCanceled);
    client.on('peerJoinTimedOut', handlePeerJoinTimedOut);
    client.on('textMessage', handleTextMessage);
    client.on('roomClosed', handleRoomClosed);
    client.on('roomExpired', handleRoomExpired);
    client.on('roomError', handleRoomError);

    return () => {
      client.off('connected', handleConnected);
      client.off('disconnected', handleDisconnected);
      client.off('reconnecting', handleReconnecting);
      client.off('roomCreated', handleRoomCreated);
      client.off('roomJoined', handleRoomJoined);
      client.off('roomRejoined', handleRoomRejoined);
      client.off('peerJoined', handlePeerJoined);
      client.off('peerDisconnected', handlePeerDisconnected);
      client.off('peerReconnected', handlePeerReconnected);
      client.off('peerLeft', handlePeerLeft);
      client.off('roomJoinPending', handleRoomJoinPending);
      client.off('peerJoinRequest', handlePeerJoinRequest);
      client.off('peerJoinCanceled', handlePeerJoinCanceled);
      client.off('peerJoinTimedOut', handlePeerJoinTimedOut);
      client.off('textMessage', handleTextMessage);
      client.off('roomClosed', handleRoomClosed);
      client.off('roomExpired', handleRoomExpired);
      client.off('roomError', handleRoomError);
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

  /** Start a fresh room session: resets state, ensures healthy open WebSocket, and sends room:create */
  const startFreshSession = useCallback(async (deviceName, requirePin = false, pin = null) => {
    const name = deviceName || myDeviceName;
    setMyDeviceName(name);
    setErrorMessage(null);
    setErrorCode(null);

    // Set Host role and connecting state upfront so UI never renders as Guest
    setIsOwner(true);
    setRoomStatus('connecting');
    setRoomId(null);
    setJoinToken(null);
    setPeerId(null);
    setPeerDeviceName(null);
    setExpiresAt(null);
    setIceServers(null);
    setMessages([]);
    setIsPeerReconnecting(false);
    setPendingJoinRequest(null);
    setIsJoinPending(false);
    setPendingRequestId(null);
    setRequirePin(Boolean(requirePin));
    setRoomPin(pin || null);
    setPinRequired(false);
    setPinError(null);
    setPinAttemptsRemaining(null);
    setJoinDenied(false);

    // Clear stored sessions
    clearRoomSession();

    // Generate fresh 256-bit room key for owner client-side
    const newRoomKey = generateRoomKey();
    roomKeyRef.current = newRoomKey;
    setRoomKey(newRoomKey);

    try {
      const wsUrl = getWebSocketUrl();
      await client.startFreshSession(name, wsUrl, requirePin, pin);
    } catch (err) {
      setRoomStatus('error');
      setErrorMessage(err.message || 'Failed to connect to signaling server');
    }
  }, [client, myDeviceName]);

  /** Create a new room */
  const createRoom = useCallback(async (deviceName, requirePin = false, pin = null) => {
    return startFreshSession(deviceName, requirePin, pin);
  }, [startFreshSession]);

  /** Join an existing room */
  const joinRoom = useCallback(async (targetRoomId, targetJoinToken, deviceName, targetRoomKey = null, pin = null) => {
    try {
      const name = deviceName || myDeviceName;
      setMyDeviceName(name);
      setRoomId(targetRoomId);
      setJoinToken(targetJoinToken);
      setErrorMessage(null);
      setErrorCode(null);
      setRoomStatus('connecting');
      setJoinDenied(false);
      roomKeyRef.current = targetRoomKey || null;
      setRoomKey(targetRoomKey || null);
      await ensureConnected();
      client.joinRoom(targetRoomId, targetJoinToken, name, pin);
    } catch (err) {
      setRoomStatus('error');
      setErrorMessage(err.message || 'Failed to connect to signaling server');
    }
  }, [client, myDeviceName, ensureConnected]);

  /** Rejoin an existing room using stored session credentials */
  const rejoinRoom = useCallback(async (targetRoomId, targetPeerId, targetSecret, deviceName) => {
    try {
      const name = deviceName || myDeviceName;
      setMyDeviceName(name);
      setErrorMessage(null);
      setErrorCode(null);
      setRoomStatus('connecting');
      const stored = getRoomSession(targetRoomId);
      if (stored?.roomKey) {
        roomKeyRef.current = stored.roomKey;
        setRoomKey(stored.roomKey);
      }
      const session = {
        roomId: targetRoomId,
        peerId: targetPeerId,
        peerSecret: targetSecret,
        deviceName: name,
        roomKey: stored?.roomKey || roomKeyRef.current || null
      };
      client.setActiveSession(session);
      await ensureConnected();
      client.rejoinRoom(targetRoomId, targetPeerId, targetSecret, name);
    } catch (err) {
      setRoomStatus('error');
      setErrorMessage(err.message || 'Failed to reconnect to room');
    }
  }, [client, myDeviceName, ensureConnected]);

  /** Host approves pending join request */
  const approveJoinRequest = useCallback((requestId, autoApprove = false) => {
    client.approveJoin(requestId, autoApprove);
    setPendingJoinRequest(null);
  }, [client]);

  /** Host denies pending join request */
  const denyJoinRequest = useCallback((requestId) => {
    client.denyJoin(requestId);
    setPendingJoinRequest(null);
  }, [client]);

  /** Joiner cancels their pending join request */
  const cancelJoinRequest = useCallback(() => {
    if (roomId && pendingRequestId) {
      client.cancelJoin(roomId, pendingRequestId);
    }
    setIsJoinPending(false);
    setPendingRequestId(null);
    setRoomStatus('idle');
  }, [client, roomId, pendingRequestId]);

  /** Joiner submits PIN */
  const submitPin = useCallback(async (candidatePin) => {
    if (!roomId || !joinToken) return;
    try {
      setErrorMessage(null);
      setErrorCode(null);
      setPinError(null);
      setRoomStatus('connecting');
      await ensureConnected();
      client.joinRoom(roomId, joinToken, myDeviceName, candidatePin);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to submit PIN');
    }
  }, [client, roomId, joinToken, myDeviceName, ensureConnected]);

  /** Joiner retries after denial if attempts remain */
  const retryJoin = useCallback(async () => {
    if (!roomId || !joinToken) return;
    try {
      setErrorMessage(null);
      setErrorCode(null);
      setJoinDenied(false);
      setRoomStatus('connecting');
      await ensureConnected();
      client.joinRoom(roomId, joinToken, myDeviceName);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to retry join');
    }
  }, [client, roomId, joinToken, myDeviceName, ensureConnected]);

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

  /** Close the room (owner action) */
  const closeRoom = useCallback(() => {
    if (roomId) {
      clearRoomSession(roomId);
    }
    roomKeyRef.current = null;
    setRoomKey(null);
    client.clearActiveSession();
    try {
      client.closeRoom();
    } catch {
      // ignore
    }
    setRoomStatus('closed');
  }, [client, roomId]);

  /** Leave the room cleanly (guest action) */
  const leaveRoom = useCallback(() => {
    if (roomId) {
      clearRoomSession(roomId);
    }
    roomKeyRef.current = null;
    setRoomKey(null);
    client.clearActiveSession();
    try {
      client.leaveRoom();
    } catch {
      // ignore
    }
    setRoomStatus('closed');
  }, [client, roomId]);

  /** Reset all room state */
  const reset = useCallback(() => {
    if (roomId) {
      clearRoomSession(roomId);
    }
    roomKeyRef.current = null;
    setRoomKey(null);
    client.clearActiveSession();
    client.disconnect();
    setRoomStatus('idle');
    setRoomId(null);
    setJoinToken(null);
    setPeerId(null);
    setIsOwner(false);
    setPeerDeviceName(null);
    setExpiresAt(null);
    setIceServers(null);
    setMessages([]);
    setErrorMessage(null);
    setErrorCode(null);
    setIsPeerReconnecting(false);
    setPendingJoinRequest(null);
    setIsJoinPending(false);
    setPendingRequestId(null);
    setRequirePin(false);
    setRoomPin(null);
    setPinRequired(false);
    setPinError(null);
    setPinAttemptsRemaining(null);
    setJoinDenied(false);
  }, [client, roomId]);

  return {
    signalingClient: client,
    connectionStatus,
    roomStatus,
    isPeerReconnecting,
    roomId,
    joinToken,
    peerId,
    isOwner,
    myDeviceName,
    peerDeviceName,
    expiresAt,
    iceServers,
    roomKey,
    messages,
    errorMessage,
    errorCode,
    // Approval & PIN state
    pendingJoinRequest,
    isJoinPending,
    pendingRequestId,
    requirePin,
    roomPin,
    pinRequired,
    pinError,
    pinAttemptsRemaining,
    joinDenied,
    // Actions
    createRoom,
    joinRoom,
    rejoinRoom,
    sendMessage,
    closeRoom,
    leaveRoom,
    reset,
    startFreshSession,
    setMyDeviceName,
    approveJoinRequest,
    denyJoinRequest,
    cancelJoinRequest,
    submitPin,
    retryJoin
  };
}
