# Backlog

완료된 작업을 다시 열지 않고 다음에 검토할 non-blocking 개선점.

- [ ] **주사율이 고정된 기기에서 적응형 품질 오판** · 저전력 모드 등으로 30Hz에 고정된 기기는 GPU 여유와 무관하게 FPS < 40으로 측정되어 pixel ratio가 최소값(0.6)까지 내려감 · 프레임 시간 대신 GPU 시간 측정 또는 `requestAnimationFrame` 간격의 분포로 상한 주사율 감지 (PR #3 리뷰에서 이월)
