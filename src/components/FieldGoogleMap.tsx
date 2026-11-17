import React, { useEffect, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import type { FirestoreSavedField } from '../shared/agronomyTypes.ts';

interface FieldGoogleMapProps {
  centerLat: number;
  centerLng: number;
  locationName: string;
  selectedCrop: string;
  predictedYield: number;
  savedFields: FirestoreSavedField[];
  onPickCoordinate: (lat: number, lng: number, label?: string) => void;
}

const ActiveFieldMarker: React.FC<{
  lat: number;
  lng: number;
  locationName: string;
  selectedCrop: string;
  predictedYield: number;
}> = ({ lat, lng, locationName, selectedCrop, predictedYield }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat, lng }}
        onClick={() => setInfoOpen((prev) => !prev)}
        title={`${locationName} (${selectedCrop}: ${predictedYield.toFixed(2)} t/ha)`}
      >
        <Pin
          background="#0f766e"
          borderColor="#134e4a"
          glyphColor="#ffffff"
        />
      </AdvancedMarker>
      {infoOpen && marker && (
        <InfoWindow
          anchor={marker}
          onCloseClick={() => setInfoOpen(false)}
        >
          <div className="text-xs text-slate-900 space-y-1 p-0.5">
            <div className="font-semibold">{locationName}</div>
            <div className="font-mono tabular-nums text-slate-600">
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </div>
            <div className="font-medium text-teal-800">
              {selectedCrop}: {predictedYield.toFixed(2)} t/ha
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

export const FieldGoogleMap: React.FC<FieldGoogleMapProps> = ({
  centerLat,
  centerLng,
  locationName,
  selectedCrop,
  predictedYield,
  savedFields,
  onPickCoordinate,
}) => {
  const [apiKey, setApiKey] = useState<string>(
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? ''
  );
  const [keyLoading, setKeyLoading] = useState<boolean>(!apiKey);

  useEffect(() => {
    if (apiKey) return;
    let active = true;
    void (async () => {
      try {
        const resp = await fetch('/api/config/maps');
        if (resp.ok) {
          const data = (await resp.json()) as { apiKey?: string };
          if (active && data.apiKey) {
            setApiKey(data.apiKey);
          }
        }
      } catch {
        // Ignore network error; fallback message handles missing key
      } finally {
        if (active) setKeyLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiKey]);

  const handleMapClick = (event: MapMouseEvent) => {
    const latLng = event.detail.latLng;
    if (!latLng) return;
    onPickCoordinate(
      Number(latLng.lat.toFixed(4)),
      Number(latLng.lng.toFixed(4)),
      `Map Sample (${latLng.lat.toFixed(2)}°, ${latLng.lng.toFixed(2)}°)`
    );
  };

  if (keyLoading) {
    return (
      <div className="h-[340px] w-full bg-slate-100 border border-slate-200 rounded-md flex items-center justify-center text-xs text-slate-500">
        Initializing interactive field map...
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="h-[340px] w-full bg-slate-100 border border-slate-200 rounded-md flex items-center justify-center p-6 text-center text-xs text-slate-600">
        Google Maps API key is unavailable. Verify your Google Maps configuration in environment secrets.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-800">
          Interactive Field Satellite &amp; Terrain Map
        </span>
        <span className="text-slate-500">
          Click anywhere on the map to sample live soil &amp; weather at that coordinate
        </span>
      </div>

      <div className="h-[340px] w-full rounded-md overflow-hidden border border-slate-200">
        <APIProvider apiKey={apiKey} libraries={['marker']}>
          <GoogleMap
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            defaultCenter={{ lat: centerLat, lng: centerLng }}
            center={{ lat: centerLat, lng: centerLng }}
            defaultZoom={10}
            mapTypeId="hybrid"
            gestureHandling="greedy"
            onClick={handleMapClick}
            className="w-full h-full"
          >
            <ActiveFieldMarker
              lat={centerLat}
              lng={centerLng}
              locationName={locationName}
              selectedCrop={selectedCrop}
              predictedYield={predictedYield}
            />

            {savedFields.map((fld) => (
              <AdvancedMarker
                key={fld.id}
                position={{ lat: fld.latitude, lng: fld.longitude }}
                onClick={() =>
                  onPickCoordinate(fld.latitude, fld.longitude, fld.name)
                }
                title={`${fld.name} (${fld.recommendedCrop}: ${fld.predictedYield} t/ha)`}
              >
                <Pin
                  background="#d97706"
                  borderColor="#92400e"
                  glyphColor="#ffffff"
                />
              </AdvancedMarker>
            ))}
          </GoogleMap>
        </APIProvider>
      </div>
    </div>
  );
};
