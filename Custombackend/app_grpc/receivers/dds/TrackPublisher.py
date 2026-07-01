# Copyright 2024 Your Name Here
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
TrackData Publisher
"""
from threading import Condition
import time

import fastdds
import TrackRealTimeStatus  # Assuming this is the generated module from your IDL

DESCRIPTION = """TrackData Publisher example for Fast DDS python bindings"""
USAGE = ('python3 TrackPublisher.py')

class TrackWriterListener(fastdds.DataWriterListener):
    def __init__(self, writer):
        self._writer = writer
        super().__init__()

    def on_publication_matched(self, datawriter, info):
        if (0 < info.current_count_change):
            print("Publisher matched subscriber {}".format(info.last_subscription_handle))
            self._writer._cvDiscovery.acquire()
            self._writer._matched_reader += 1
            self._writer._cvDiscovery.notify()
            self._writer._cvDiscovery.release()
        else:
            print("Publisher unmatched subscriber {}".format(info.last_subscription_handle))
            self._writer._cvDiscovery.acquire()
            self._writer._matched_reader -= 1
            self._writer._cvDiscovery.notify()
            self._writer._cvDiscovery.release()

class TrackWriter:
    def __init__(self):
        self._matched_reader = 0
        self._cvDiscovery = Condition()
        self.track_id = 1000  # Starting track ID

        factory = fastdds.DomainParticipantFactory.get_instance()
        self.participant_qos = fastdds.DomainParticipantQos()
        factory.get_default_participant_qos(self.participant_qos)
        factory.load_XML_profiles_file("track_publisher.xml")
        self.participant = factory.create_participant_with_profile(142, "track_publisher_client")
        #self.participant = factory.create_participant(0, self.participant_qos)

        self.topic_data_type = TrackRealTimeStatus.TrackDataClassPubSubType()
        self.topic_data_type.set_name("TrackDataClassDataType")
        self.type_support = fastdds.TypeSupport(self.topic_data_type)
        self.participant.register_type(self.type_support)

        self.topic_qos = fastdds.TopicQos()
        self.participant.get_default_topic_qos(self.topic_qos)
        self.topic = self.participant.create_topic(
            "TrackDataClassTopic_FuseTrack", 
            self.topic_data_type.get_name(), 
            self.topic_qos)

        self.publisher_qos = fastdds.PublisherQos()
        self.participant.get_default_publisher_qos(self.publisher_qos)
        self.publisher = self.participant.create_publisher(self.publisher_qos)

        self.listener = TrackWriterListener(self)
        self.writer_qos = fastdds.DataWriterQos()
        self.publisher.get_default_datawriter_qos(self.writer_qos)
        self.writer = self.publisher.create_datawriter(
            self.topic, 
            self.writer_qos, 
            self.listener)

    def write(self):
        data = TrackRealTimeStatus.TrackDataClass()
        
        # Set track data values
        data.trackId(self.track_id)
        # data.mmsi(123456789)
        # data.uniqueId(self.track_id + 10000)
        # data.longitude(116.391 + (self.track_id % 100) * 0.01)
        # data.latitude(39.907 + (self.track_id % 100) * 0.01)
        # data.course(45.0)
        # data.distance(1000.0)
        # data.speed(10.0)
        # data.speed_N(7.07)  # North component at 45° course
        # data.speed__E(7.07)  # East component at 45° course
        # data.speed_V(0.0)
        # data.height(50.0)
        # data.azimuth(30.0)
        # data.range(5000.0)
        # data.sizeMetres(20.0)
        # data.sizeDegrees(0.01)
        # data.radarId("RADAR001")
        # data.dotID(self.track_id * 10)
        # data.trackQuality(90)
        # data.fusion(1)  # Fused track
        # data.sensors(0b00000011)  # Using first two sensors
        # for i in range(8):
        #     data.trackID(i, self.track_id + i)  # Set array elements
        # data.timeStamp(int(time.time()))
        # data.threatScore(30.5)
        # data.threatLevel(1)  # Low threat
        # data.trackCategoryId(1)
        # data.trackCategoryName("Commercial Vessel")
        # data.trackAlias("Ship-{}".format(self.track_id))
        # data.isManual(False)
        # data.modifiedBy("system")
        # data.modifiedTime(int(time.time()))
        # Reserved fields can be left default
        
        self.writer.write(data)
        print(f"Published Track ID: {data.trackId()}")
        self.track_id += 1

    def wait_discovery(self):
        self._cvDiscovery.acquire()
        print("Writer is waiting discovery...")
        self._cvDiscovery.wait_for(lambda: self._matched_reader != 0)
        self._cvDiscovery.release()
        print("Writer discovery finished...")

    def run(self):
        self.wait_discovery()
        try:
            while True:
                time.sleep(1)
                self.write()
        except KeyboardInterrupt:
            print("Publisher stopped by user")
        finally:
            self.delete()

    def delete(self):
        factory = fastdds.DomainParticipantFactory.get_instance()
        self.participant.delete_contained_entities()
        factory.delete_participant(self.participant)

if __name__ == '__main__':
    print('Starting TrackData publisher.')
    writer = TrackWriter()
    writer.run()
    exit()