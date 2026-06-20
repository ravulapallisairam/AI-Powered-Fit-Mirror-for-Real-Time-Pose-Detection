# AI-Powered Fit Mirror for Real-Time Pose Detection

An AI-powered web application for real-time human pose detection and posture analysis. The application supports image upload, video upload, and live webcam-based pose estimation with skeleton visualization and instant posture feedback.

## Features

### Pose Detection

* Real-time pose detection from images, videos, and webcam streams.
* Human skeleton visualization using keypoints.
* Multi-person pose detection support.

### Exercise Tracking

* Squat repetition counter.
* Push-up repetition counter.
* Bicep curl repetition counter.
* Angle-based exercise analysis.
* Audio beep notifications.
* Reset exercise session button.

### Detection Settings

* Confidence threshold adjustment.
* Model quality selection (Lightning/Thunder).
* Mirror webcam option.
* Keypoint smoothing.
* Voice feedback support.

### Session Analytics

* Live sparkline chart.
* Average posture score.
* Session duration statistics.
* CSV export.
* PNG snapshot capture.

### Dashboard Modules

* Overview
* History
* Trends
* Exercise Analytics
* People Tracking

### Additional Features

* Dark/Light Theme Toggle.
* Automatic Session Archiving.
* PDF Report Generation.
* Single-page implementation in a single `index.html` file.

## Technologies Used

* HTML5
* CSS3
* JavaScript
* MediaPipe Pose
* TensorFlow.js
* OpenCV (Optional)
* Canvas API
* WebRTC
* Chart.js
* jsPDF
* Browser Storage APIs

## Installation

```bash
git clone https://github.com/yourusername/AI-Fit-Mirror.git
cd AI-Fit-Mirror
```

Open `index.html` in your browser.

## Usage

1. Upload an image.
2. Upload a video.
3. Start the webcam.
4. Analyze posture in real time.
5. View session analytics.
6. Export reports in CSV, PNG, or PDF formats.

## Future Enhancements

* 3D Avatar Visualization
* AI Personal Trainer
* Nutrition Assistant
* RAG-based Fitness Knowledge Base
* LLM-powered Fitness Chatbot
