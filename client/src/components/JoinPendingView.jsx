import React from 'react';
import { Clock, ShieldX, RotateCw, X, ShieldAlert } from 'lucide-react';

/**
 * Joiner waiting view displayed while waiting for the host to approve the join request,
 * or when the join request is denied / timed out.
 */
export function JoinPendingView({
  isPending,
  isDenied,
  errorMessage,
  onCancel,
  onRetry
}) {
  if (isDenied) {
    return (
      <div className="join-pending-card" role="region" aria-label="Join request declined">
        <div className="join-denied-icon-tile" aria-hidden="true">
          <ShieldX size={32} strokeWidth={1.75} />
        </div>
        <h3 className="join-pending-title">Join Request Declined</h3>
        <p className="join-pending-subtext">
          {errorMessage || 'The host declined your join request or the request timed out after 60 seconds.'}
        </p>
        <div className="join-pending-actions">
          <button
            type="button"
            onClick={onRetry}
            className="btn btn-primary"
          >
            <RotateCw size={15} strokeWidth={2} />
            <span>Try again</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="join-pending-card" role="region" aria-live="polite" aria-label="Waiting for host approval">
      <div className="join-pending-spinner-wrap" aria-hidden="true">
        <div className="join-pending-pulse-ring" />
        <Clock size={32} strokeWidth={1.75} className="join-pending-clock" />
      </div>

      <h3 className="join-pending-title">Waiting for host to approve...</h3>
      <p className="join-pending-subtext">
        The host has received your join request and is reviewing it.
      </p>

      <div className="join-pending-actions">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-secondary"
          aria-label="Cancel join request"
        >
          <X size={15} strokeWidth={2} />
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );
}
