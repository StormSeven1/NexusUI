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
TrackRealTimeStatus Subscriber
"""
import signal

import fastdds
import TrackRealTimeStatus  # Assuming this is the generated module from your IDL

DESCRIPTION = """TrackRealTimeStatus Subscriber example for Fast DDS python bindings"""
USAGE = ('python3 TrackSubscriber.py')

# To capture ctrl+C
def signal_handler(sig, frame):
    print('Interrupted!')

class TrackReaderListener(fastdds.DataReaderListener):
    def __init__(self):
        super().__init__()
        self.num = 0

    def on_subscription_matched(self, datareader, info):
        if (0 < info.current_count_change):
            print("Subscriber matched publisher {}".format(info.last_publication_handle))
        else:
            print("Subscriber unmatched publisher {}".format(info.last_publication_handle))
            self.num = 0

    def on_data_available(self, reader):
        info = fastdds.SampleInfo()
        data = TrackRealTimeStatus.TrackDataClass()
        reader.take_next_sample(data, info)
        self.num += 1
        print(f"Sample {self.num} RECEIVED")

        # Print all the received track data
        # print("\nReceived Track Data:")
        # print(f"Track ID: {data.trackId()}")
        # print(f"MMSI: {data.mmsi()}")
        # print(f"Unique ID: {data.uniqueId()}")
        # print(f"Position: Longitude={data.longitude()}, Latitude={data.latitude()}")
        # print(f"Course: {data.course()}°, Distance: {data.distance()}")
        # print(f"Speed: {data.speed()} (N:{data.speed_N()}, E:{data.speed__E()}, V:{data.speed_V()})")
        # print(f"Height: {data.height()}")
        # print(f"Azimuth: {data.azimuth()}°, Range: {data.range()}")
        # print(f"Size: {data.sizeMetres()}m / {data.sizeDegrees()}°")
        # print(f"Radar ID: {data.radarId()}")
        # print(f"Dot ID: {data.dotID()}")
        # print(f"Track Quality: {data.trackQuality()}")
        # print(f"Fusion: {'Fused' if data.fusion() == 1 else 'Non-fused'}")
        # print(f"Sensors: {bin(data.sensors())}")
        # print(f"Track IDs: {[data.trackID(i) for i in range(8)]}")
        # print(f"Timestamp: {data.timeStamp()}")
        # print(f"Threat Score: {data.threatScore()}, Level: {data.threatLevel()}")
        # print(f"Category: {data.trackCategoryId()} - {data.trackCategoryName()}")
        # print(f"Alias: {data.trackAlias()}")
        # print(f"Manual: {'Yes' if data.isManual() else 'No'}")
        # print(f"Modified by: {data.modifiedBy()} at {data.modifiedTime()}")
        # print("----------------------------------------")

class Reader:
    def __init__(self):
        factory = fastdds.DomainParticipantFactory.get_instance()
        self.participant_qos = fastdds.DomainParticipantQos()
        factory.get_default_participant_qos(self.participant_qos)
        factory.load_XML_profiles_file("track_subscriber.xml")
        self.participant = factory.create_participant_with_profile(142, "track_subscriber_client")
        #self.participant = factory.create_participant(142, self.participant_qos)

        if (self.participant == None):
            print("TrackDataClass Participant initialization failed")
            return
        
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

        self.subscriber_qos = fastdds.SubscriberQos()
        self.participant.get_default_subscriber_qos(self.subscriber_qos)
        self.subscriber = self.participant.create_subscriber(self.subscriber_qos)

        self.listener = TrackReaderListener()
        self.reader_qos = fastdds.DataReaderQos()
        self.subscriber.get_default_datareader_qos(self.reader_qos)
        self.reader = self.subscriber.create_datareader(
            self.topic, 
            self.reader_qos, 
            self.listener)
        print('init success')

    def delete(self):
        factory = fastdds.DomainParticipantFactory.get_instance()
        self.participant.delete_contained_entities()
        factory.delete_participant(self.participant)
        self.listener.num = 0

    def run(self):
        signal.signal(signal.SIGINT, signal_handler)
        print('Press Ctrl+C to stop')
        signal.pause()
        self.delete()

if __name__ == '__main__':
    print('Creating TrackRealTimeStatus subscriber.')
    reader = Reader()
    reader.run()
    exit()
