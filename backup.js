'use strict';
import React, { Component } from 'react';
import { SafeAreaView, KeyboardAvoidingView ,TextInput  ,AppRegistry, Picker, StyleSheet, Text, TouchableHighlight, View, Image, ImageBackground, ListView, Platform, Dimensions, TouchableOpacity} from 'react-native';
import SocketIOClient from 'socket.io-client';
import { RTCPeerConnection, RTCMediaStream, RTCIceCandidate, RTCSessionDescription, RTCView, MediaStreamTrack, getUserMedia, } from 'react-native-webrtc';
import FBSDK, { LoginManager, LoginButton } from 'react-native-fbsdk';
import { StackNavigator, TabNavigator, NavigationActions } from 'react-navigation';
import { SocialIcon, Icon, Button, Input } from 'react-native-elements';
import InCallManager from 'react-native-incall-manager';
import {firebase} from './services/firebase';

const socket = SocketIOClient.connect('https://react-native-webrtc.herokuapp.com', {transports: ['websocket']}); 
const pcPeers = {};
const configuration = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};

let container;
let localStream;

const logo = require('./images/one.jpg')


  /*-------------------------------------------------------------------
      ALL WEB RTC FUNCTIONALITY READY TO BE CALLED IN CLASS MAIN
  --------------------------------------------------------------------*/   
function join(roomID) {

  socket.emit('join', roomID, function(socketIds){
    console.log('join', socketIds);
    for (const i in socketIds) {
      const socketId = socketIds[i];
      
      createPC(socketId, true);
      
    }
  });
}

function getLocalStream(isFront, callback) {

  let videoSourceId;
  
    // on android, you don't have to specify sourceId manually, just use facingMode
    // uncomment it if you want to specify
    if (Platform.OS === 'ios') {
      MediaStreamTrack.getSources(sourceInfos => {
        console.log("sourceInfos: ", sourceInfos);
  
        for (const i = 0; i < sourceInfos.length; i++) {
          const sourceInfo = sourceInfos[i];
          if(sourceInfo.kind == "video" && sourceInfo.facing == (isFront ? "front" : "back")) {
            videoSourceId = sourceInfo.id;
          }
        }
      });
    }
    getUserMedia({
      
      audio: true,
      video: {
        mandatory: {
          minWidth: 640, // Provide your own width, height and frame rate here
          minHeight: 360,
          minFrameRate: 30,
        },
        facingMode: (isFront ? "user" : "environment"),
        optional: (videoSourceId ? [{sourceId: videoSourceId}] : []),
      }
    }, function (stream) {
      console.log('getUserMedia success', stream);
      callback(stream);
    }, logError);
    
  }

  function join(roomID) {
    socket.emit('join', roomID, function(socketIds){
      console.log('join', socketIds);
      for (const i in socketIds) {
        const socketId = socketIds[i];
        createPC(socketId, true);
        
      }
    });
  }

  function createPC(socketId, isOffer) {
    const pc = new RTCPeerConnection(configuration);
    pcPeers[socketId] = pc;
    
  
    pc.onicecandidate = function (event) {
      console.log('onicecandidate', event.candidate);
      if (event.candidate) {
        socket.emit('exchange', {'to': socketId, 'candidate': event.candidate });
      }
    };
  
    function createOffer() {
      pc.createOffer(function(desc) {
        console.log('createOffer', desc);
        pc.setLocalDescription(desc, function () {
          console.log('setLocalDescription', pc.localDescription);
          socket.emit('exchange', {'to': socketId, 'sdp': pc.localDescription });
        }, logError);
      }, logError);
    }
  
    pc.onnegotiationneeded = function () {
      console.log('onnegotiationneeded');
      if (isOffer) {
        createOffer();
      }
    }
  
    pc.oniceconnectionstatechange = function(event) {
      console.log('oniceconnectionstatechange', event.target.iceConnectionState);
      if (event.target.iceConnectionState === 'completed') {
        setTimeout(() => {
          getStats();
        }, 1000);
      }
      if (event.target.iceConnectionState === 'connected') {
        createDataChannel();
      }
    };
    pc.onsignalingstatechange = function(event) {
      console.log('onsignalingstatechange', event.target.signalingState);
    };
  
    pc.onaddstream = function (event) {
      
      
      console.log('onaddstream', event.stream);
      container.setState({info: 'One peer join!'});
  
      const remoteList = container.state.remoteList;
      remoteList[socketId] = event.stream.toURL();
      container.setState({ remoteList: remoteList });
    };
    pc.onremovestream = function (event) {
      console.log('onremovestream', event.stream);
    };
  
    pc.addStream(localStream);
    function createDataChannel() {
      if (pc.textDataChannel) {
        return;
      }
      const dataChannel = pc.createDataChannel("text");
  
      dataChannel.onerror = function (error) {
        console.log("dataChannel.onerror", error);
      };
  
      dataChannel.onmessage = function (event) {
        console.log("dataChannel.onmessage:", event.data);
        container.receiveTextData({user: socketId, message: event.data});
      };
  
      dataChannel.onopen = function () {
        console.log('dataChannel.onopen');
        container.setState({textRoomConnected: true});
      };
  
      dataChannel.onclose = function () {
        console.log("dataChannel.onclose");
      };
  
      pc.textDataChannel = dataChannel;
    }
    return pc;
  }

  function exchange(data) {
    const fromId = data.from;
    let pc;
    if (fromId in pcPeers) {
      pc = pcPeers[fromId];
    } else {
      pc = createPC(fromId, false);
    }
  
    if (data.sdp) {
      console.log('exchange sdp', data);
      pc.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
        if (pc.remoteDescription.type == "offer")
          pc.createAnswer(function(desc) {
            console.log('createAnswer', desc);
            pc.setLocalDescription(desc, function () {
              console.log('setLocalDescription', pc.localDescription);
              socket.emit('exchange', {'to': fromId, 'sdp': pc.localDescription });
            }, logError);
          }, logError);
      }, logError);
    } else {
      console.log('exchange candidate', data);
      pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }

  function leave(socketId) {
    console.log('leave', socketId);
    const pc = pcPeers[socketId];
    const viewIndex = pc.viewIndex;
    pc.close();
    delete pcPeers[socketId];
  
    const remoteList = container.state.remoteList;
    delete remoteList[socketId]
    container.setState({ remoteList: remoteList });
    container.setState({info: 'One peer leave!'});
  }

  socket.on('exchange', function(data){
    exchange(data);
  });
  socket.on('leave', function(socketId){
    leave(socketId);
  });

  socket.on('connect', function(data) {
    console.log('connect');
    getLocalStream(true, function(stream) {
      localStream = stream;
      container.setState({selfViewSrc: stream.toURL()});
      container.setState({status: 'ready', info: 'Please enter or create room ID'});
    });
  });

  function logError(error) {
    console.log("logError", error);
  }

  function mapHash(hash, func) {
    const array = [];
    for (const key in hash) {
      const obj = hash[key];
      array.push(func(obj, key));
    }
    return array;
  }

  function getStats() {
    const pc = pcPeers[Object.keys(pcPeers)[0]];
    if (pc.getRemoteStreams()[0] && pc.getRemoteStreams()[0].getAudioTracks()[0]) {
      const track = pc.getRemoteStreams()[0].getAudioTracks()[0];
      console.log('track', track);
      pc.getStats(track, function(report) {
        console.log('getStats report', report);
      }, logError);
    }
  }

  /*function thirdScreen() {
    this.navigator.dispatch(
      NavigationActions.navigate({
        thirdScreen: 'ClassStream',
      }),
    )
  }*/



  /*-------------------------------------------------------------------
            FACEBOOK LOGIN SCREEN WITH FB AUTH BUTTON PRESS
  --------------------------------------------------------------------*/
 
   class FacebookLogin extends Component { 
     constructor(props) {
       super(props)
       this.state = {
         email: '',
         password:''
       }
     }
     

     static navigationOptions = {
       title: 'FacebookLogin'
     }

     login = () => {
      
      try {
          if (this.state.email === "") {
              throw new Error("Please provide an email address.");
          }
          if (this.state.password === "") {
              throw new Error("Please provide a password.");
          }
          else if (firebase.auth().signInWithEmailAndPassword(this.state.email, this.state.password)) {
            //alert('successful login')
            this.props.navigation.navigate('secondScreen')     
          }
      } 

      catch(e) {
          alert(e);
      }
    }

    
      /* _fbAuth() {
          LoginManager.logInWithReadPermissions(['public_profile']).then(
             function(result) {
                if (result.isCancelled) {
                   alert('Login cancelled');
                } //else {
                   //alert('Login success with permissions: '
                   //+result.grantedPermissions.toString());
                   //props.navigation.navigate('secondScreen')
                   //navigate('secondScreen');

                   

                //}
             },
             function(error) {
                alert('Login fail with error: ' + error);
             },

          );
       }*/
       resetNavigation(targetRoute) {
        const resetAction = NavigationActions.reset({
          index: 0,
          actions: [
            NavigationActions.navigate({ routeName: targetRoute }),
          ],
        });
        this.props.navigation.dispatch(resetAction);
      }
       //onPress={() => this.props.navigation.navigate('secondScreen')}
       //{() => navigate('secondScreen')}
    
       render() {
        
        const {navigate} = this.props.navigation;
        return(
            <View style = {loginstyles.container}>
                <View style = {loginstyles.buttonContainer} keyboardVerticalOffset = {10}>
                    <Text style = {loginstyles.miniHeader}>
                      GET STARTED

                    </Text>

                    <Text style = {loginstyles.header}>
                      Login

                    </Text>
                    
                    <Input
                    containerStyle={loginstyles.input}
                    keyboardType="email-address"
                    autoCorrect = {false}
                    placeholder='Email'
                    placeholderTextColor = '#000000'
                    onChangeText={(text) => this.setState({email: text})} 
                    value = {this.state.email}
                    />

                    <Input
                    containerStyle = {loginstyles.input}
                    secureTextEntry = {true}
                    placeholder='Password'
                    placeholderTextColor = '#000000'
                    onChangeText={(text) => this.setState({password: text})} 
                    value = {this.state.password}
                    />

                    <Button 
                    text = 'Login'
                    raised
                    backgroundColor = '#FFF'
                    small
                    textStyle = {{fontWeight: 'bold'}}
                    onPress = {this.login}
                    buttonStyle={styles.loginButton} /> 

                    <Button 
                    text = 'Back'
                    clear
                    //backgroundColor = '#3BA9FF'
                    small
                    textStyle = {{fontWeight: 'bold', color: '#909497', fontSize: 15}}
                    onPress = {this.back} />

                </View>
                


            </View>
        );
    }
}

const loginstyles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#FFFFFF',  
    },
    
    loginContainer: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center'
      //justifyContent: 'space-between'
    },
    
    loginButton: {
      //justifyContent: 'flex-start',
      backgroundColor: "#3BA9FF",
      width: 300,
      height: 45,
      borderColor: "transparent",
      borderWidth: 0,

    }, 
   
    buttonContainer: {
      alignItems: 'center',
      flexDirection: 'column',
      top: 40
    },

    input: {
      borderWidth: 1,
      width: 300,
      borderColor: '#F2F3F4',
      margin: 10,
      height: 50,
      paddingLeft: 10,
      
    },

    miniHeader: {
      fontWeight: '900', 
      color: '#909497', 
      fontSize: 15,
      justifyContent: 'flex-start',
      marginRight: 195,
      marginTop: 15,
      paddingBottom: 5,
      

    },

    header: {
      fontWeight: '900', 
      color: '#000000', 
      fontSize: 40,
      marginRight: 195,
      paddingBottom: 10,

    }
  });

 /*-------------------------------------------------------------------
              WEB RTC SCREEN FOR JOINING AND MAKING CALLS 
  --------------------------------------------------------------------*/

class Main extends Component {

  constructor(props){
    super(props)

    this.onPress = this.onPress.bind(this);
    this.state = {
      videoURL: null,
      isFront: true,
      info: 'Initializing',
      status: 'init',
      roomID: 'BIO281A',
      selfViewSrc: null,
      remoteList: {},
      textRoomConnected: false,
      textRoomData: [],
      textRoomValue: '',
      PickerValue: '',
    }

  }
  
  //DECLARE EACH STATE TO PASS DATA THROUGH LATER
 

  componentDidMount() {
    
      container = this;
      //const {navigate} = this.props.navigation;

    }

   
    
    /*style={{height: 40, textAlign: 'center',}}
    ref='roomID'
    autoCorrect={false}
    placeholder={"Enter room"} placeholderTextColor={"#888"} 
    onChangeText={(text) => this.setState({roomID: text})}
    value={this.state.roomID}*/

    //onPress={this.onPress.bind(this)}
  //ACTUALLY SHOW THE VIDEO HERE AND DO STYLING
  render() {
    const {navigate} = this.props.navigation;
    return (
       
       <ImageBackground source = {logo} style = {styles.background}>
        
      
          <Text style={styles.titleText}>CHOOSE A CLASS</Text>
          <Picker
              itemStyle={{color: '#F0FFFF'}}
              style={{width:'80%'}}
              selectedValue={this.state.roomID}
              onValueChange={(itemValue, itemIndex) => this.setState({roomID : itemValue})}>
              <Picker.item label = "BIO 281A: Biology and Biotechnology" value = "BIO281A"/>
              <Picker.item label = "BIO 281B: Biology and Biotechnology" value = "BIO281B"/>
              <Picker.item label = "CH 116A: General Chemistry II" value = "CH116A"/>
              <Picker.item label = "CH 116B: General Chemistry II" value = "CH116B"/>
              <Picker.item label = "CH 116C: General Chemistry II" value = "CH116C"/>
              <Picker.item label = "CH 116D: General Chemistry II" value = "CH116D"/>
              <Picker.item label = "CH 116E: General Chemistry II" value = "CH116E"/>
              <Picker.item label = "CH 116F: General Chemistry II" value = "CH116F"/>
              <Picker.item label = "CH 116G: General Chemistry II" value = "CH116G"/>
              <Picker.item label = "MA 123A: Series, Vectors, Functions, and Surfaces" value = "MA123A"/>
              <Picker.item label = "MA 123B: Series, Vectors, Functions, and Surfaces" value = "MA123B"/>
              <Picker.item label = "MA 123C: Series, Vectors, Functions, and Surfaces" value = "MA123C"/>
              <Picker.item label = "MA 123D: Series, Vectors, Functions, and Surfaces" value = "MA123D"/>
              <Picker.item label = "MA 123E: Series, Vectors, Functions, and Surfaces" value = "MA123E"/>
              <Picker.item label = "MA 123F: Series, Vectors, Functions, and Surfaces" value = "MA123F"/>
              <Picker.item label = "MA 123G: Series, Vectors, Functions, and Surfaces" value = "MA123G"/>
              <Picker.item label = "MA 123H: Series, Vectors, Functions, and Surfaces" value = "MA123H"/>
              <Picker.item label = "MA 123I: Series, Vectors, Functions, and Surfaces" value = "MA123I"/>
              <Picker.item label = "PEP 111A: Mechanics" value = "PEP111A"/>
              <Picker.item label = "PEP 111B: Mechanics" value = "PEP111B"/>
              <Picker.item label = "PEP 111C: Mechanics" value = "PEP111C"/>
              <Picker.item label = "PEP 111D: Mechanics" value = "PEP111D"/>
              <Picker.item label = "PEP 111E: Mechanics" value = "PEP111E"/>
              <Picker.item label = "PEP 111S: Mechanics" value = "PEP111S"/>
          </Picker>
          <View style={{padding:40}}>
          <Button outline rounded large /*underlayColor='#107896'*/ title="   Join Class   " icon={{name:'tv'}} 
          onPress ={() => {
            //join(this.state.roomID);
            navigate('thirdScreen',  
            { roomID: this.state.roomID, 
              remoteList: this.state.remoteList, 
              videoURL: this.state.videoURL, 
              isFront: this.state.isFront, 
              info: this.state.info, 
              selfViewSrc: this.state.selfViewSrc,
              status: this.state.status} );
            
            //InCallManager.start({media: 'audio'}); // audio/video, default: audio
            //InCallManager.setForceSpeakerphoneOn( true );
          }}
          />
          
          </View>
        
      </ImageBackground>
       
    );

  }

  
  //JOIN THE ROOM
  onPress(event) {
    
          //alert(this.state.roomID);
          //this.refs.roomID.blur();
          //this.setState({status: 'connect', info: 'Connecting'});
          //join(this.state.roomID);
          //this.props.navigation.navigate(thirdScreen);
          //InCallManager.start({media: 'audio'}); // audio/video, default: audio
          //InCallManager.setForceSpeakerphoneOn( true );
          
        }

}

class ClassStream extends Component { 
  
  constructor(props){
    super(props)

    this.state = {
      videoURL: this.props.navigation.state.params.videoURL,
      isFront: this.props.navigation.state.params.isFront,
      roomID: this.props.navigation.state.params.roomID,
      selfViewSrc: this.props.navigation.state.params.selfViewSrc,
      remoteList: this.props.navigation.state.params.remoteList,
    }

  }

  componentDidMount(){
    container = this;
    //join(this.state.roomID);
    //InCallManager
  }
 

  static navigationOptions = {
    title: 'ClassStream'
  }

    render() {
      
      join(this.state.roomID);
      InCallManager.start({media: 'audio'}); // audio/video, default: audio
      InCallManager.setForceSpeakerphoneOn( true );
     
     
     
       return (
         
         
          <View >
             {
          mapHash(this.state.remoteList, function(remote, index) {
            return <RTCView key={index} streamURL={remote} style={styles.remoteView}/>})
            }
            
          </View>
       );
    }
}

/*---------------------------------------------------------------------------------------
                                  MAIN RTC SCREEN STYLING
 ---------------------------------------------------------------------------------------*/
const styles = StyleSheet.create({
  background: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',




  },
  button: {
    backgroundColor:'#1496BB',
    borderRadius:15,
    overflow: 'hidden',
    paddingHorizontal: 30,
    

  },

  backgroundImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    

  },
  backgroundImage1: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',

  },
  selfView: {
    width: 200,
    height: 150,
    position: 'absolute',
    bottom: 0,
    left: 0,
  },
  remoteView: {
    position: "absolute",
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
   
    resizeMode: 'cover',

  },

  titleText: {
    fontSize: 30,
    fontWeight: "bold",
    backgroundColor: 'transparent',
    color: '#F0FFFF',
  }
});


/*---------------------------------------------------------------------------------------
  NAVIGATION FOR ALL SCREENS. MUST DECLARE SCREEN CLASS ABOVE THEN CALL IN THIS NAVIGATOR 
  ---------------------------------------------------------------------------------------*/


const DefaultNav = StackNavigator({
  firstScreen: {
      screen: FacebookLogin,
      navigationOptions: {
          title: 'Sign Up',
          gesturesEnabled: false,
          
      }
  },
  secondScreen: {
      screen: Main,
      navigationOptions: {
          title: 'Class Selection',
          gesturesEnabled: false,
      }
  },
  thirdScreen: {
    screen: ClassStream,
    navigationOptions: {
      title: 'Class Stream'
    }
  },
});

/*---------------------------------------------------------------------------------------
        EXPORT APP CLASS ONLY SO NAVIGATOR CAN USE SCREEN PROPERTIES AS PROPS 
  ---------------------------------------------------------------------------------------*/
export default class App extends Component {
  
  render() {
    
    return <DefaultNav />;
  }
}


/*            <Picker.item label = "CAL 103A: Writing And Communications Colloquium" value = "CAL103A"/>
              <Picker.item label = "CAL 103B: Writing And Communications Colloquium" value = "CAL103B"/>
              <Picker.item label = "CAL 105A: Knowledge, Nature, Culture" value = "CAL105A"/>
              <Picker.item label = "CAL 105A1: Knowledge, Nature, Culture" value = "CAL105A1"/>
              <Picker.item label = "CAL 105A2: Knowledge, Nature, Culture" value = "CAL105A2"/>
              <Picker.item label = "CAL 105A3: Knowledge, Nature, Culture" value = "CAL105A3"/>
              <Picker.item label = "CAL 105A4: Knowledge, Nature, Culture" value = "CAL105A4"/>
              <Picker.item label = "CAL 105A5: Knowledge, Nature, Culture" value = "CAL105A5"/>
              <Picker.item label = "CAL 105A6: Knowledge, Nature, Culture" value = "CAL105A6"/>
              <Picker.item label = "CAL 105A7: Knowledge, Nature, Culture" value = "CAL105A7"/>
              <Picker.item label = "CAL 105A8: Knowledge, Nature, Culture" value = "CAL105A8"/>
              <Picker.item label = "CAL 105B: Knowledge, Nature, Culture" value = "CAL105B"/>
              <Picker.item label = "CAL 105C: Knowledge, Nature, Culture" value = "CAL105C"/>
              <Picker.item label = "CAL 105D: Knowledge, Nature, Culture" value = "CAL105D"/>
              <Picker.item label = "CAL 105E: Knowledge, Nature, Culture" value = "CAL105E"/>
              <Picker.item label = "CAL 105F: Knowledge, Nature, Culture" value = "CAL105F"/>
              <Picker.item label = "CAL 105G: Knowledge, Nature, Culture" value = "CAL105G"/>
              <Picker.item label = "CAL 105H: Knowledge, Nature, Culture" value = "CAL105H"/>
              <Picker.item label = "CAL 105I: Knowledge, Nature, Culture" value = "CAL105I"/>
              <Picker.item label = "CAL 105J: Knowledge, Nature, Culture" value = "CAL105J"/>
              <Picker.item label = "CAL 105K: Knowledge, Nature, Culture" value = "CAL105K"/>
              <Picker.item label = "CAL 105L: Knowledge, Nature, Culture" value = "CAL105L"/>
              <Picker.item label = "CAL 105M: Knowledge, Nature, Culture" value = "CAL105M"/>
              <Picker.item label = "CAL 105N: Knowledge, Nature, Culture" value = "CAL105N"/>
              <Picker.item label = "CAL 105O: Knowledge, Nature, Culture" value = "CAL105O"/>
              <Picker.item label = "CAL 105P: Knowledge, Nature, Culture" value = "CAL105P"/>
              <Picker.item label = "CAL 105Q: Knowledge, Nature, Culture" value = "CAL105Q"/>
              <Picker.item label = "CAL 105R: Knowledge, Nature, Culture" value = "CAL105R"/>
              <Picker.item label = "CAL 105S: Knowledge, Nature, Culture" value = "CAL105S"/>
              <Picker.item label = "CAL 105T: Knowledge, Nature, Culture" value = "CAL105T"/>
              <Picker.item label = "CAL 105U: Knowledge, Nature, Culture" value = "CAL105U"/>
              <Picker.item label = "CAL 105V: Knowledge, Nature, Culture" value = "CAL105V"/>
              <Picker.item label = "CAL 105W: Knowledge, Nature, Culture" value = "CAL105W"/>
              <Picker.item label = "CAL 105X: Knowledge, Nature, Culture" value = "CAL105X"/>
              <Picker.item label = "CAL 105Y: Knowledge, Nature, Culture" value = "CAL105Y"/>
              <Picker.item label = "CAL 105Z: Knowledge, Nature, Culture" value = "CAL105Z"/>
              
              <Picker.item label = "E 122E: Engineering Design II" value = "E122E"/>
              <Picker.item label = "E 122F: Engineering Design II" value = "E122F"/>
              <Picker.item label = "E 122G: Engineering Design II" value = "E122G"/>
              <Picker.item label = "E 122I: Engineering Design II" value = "E122I"/>
              <Picker.item label = "E 122K: Engineering Design II" value = "E122K"/>
              <Picker.item label = "E 122M: Engineering Design II" value = "E122M"/>
              <Picker.item label = "E 122N: Engineering Design II" value = "E122N"/>
              <Picker.item label = "E 122O: Engineering Design II" value = "E122O"/>
              <Picker.item label = "E 122R: Engineering Design II" value = "E122R"/>
              <Picker.item label = "E 122S: Engineering Design II" value = "E122S"/>
              <Picker.item label = "E 122V: Engineering Design II" value = "E122V"/>
              <Picker.item label = "E 122W: Engineering Design II" value = "E122W"/>
              
              <Picker.item label = "MGT 103A: Intro to Entrepreneurial Thinking" value = "MGT103A"/>
              <Picker.item label = "MGT 103B: Intro to Entrepreneurial Thinking" value = "MGT103B"/>
              <Picker.item label = "MGT 103C: Intro to Entrepreneurial Thinking" value = "MGT103C"/>
              <Picker.item label = "MGT 103D: Intro to Entrepreneurial Thinking" value = "MGT103D"/>
              <Picker.item label = "MGT 103E: Intro to Entrepreneurial Thinking" value = "MGT103E"/>
              <Picker.item label = "MGT 103F: Intro to Entrepreneurial Thinking" value = "MGT103F"/>
              <Picker.item label = "MGT 103G: Intro to Entrepreneurial Thinking" value = "MGT103G"/>
              <Picker.item label = "MGT 103H: Intro to Entrepreneurial Thinking" value = "MGT103H"/>
              <Picker.item label = "MGT 103I: Intro to Entrepreneurial Thinking" value = "MGT103I"/>
              <Picker.item label = "MGT 103J: Intro to Entrepreneurial Thinking" value = "MGT103J"/>
              <Picker.item label = "MGT 103K: Intro to Entrepreneurial Thinking" value = "MGT103K"/>
              <Picker.item label = "MGT 103L: Intro to Entrepreneurial Thinking" value = "MGT103L"/>
              <Picker.item label = "MGT 103M: Intro to Entrepreneurial Thinking" value = "MGT103M"/>
              <Picker.item label = "MGT 103N: Intro to Entrepreneurial Thinking" value = "MGT103N"/>
              <Picker.item label = "MGT 103O: Intro to Entrepreneurial Thinking" value = "MGT103O"/>
              <Picker.item label = "MGT 103P: Intro to Entrepreneurial Thinking" value = "MGT103P"/>
              <Picker.item label = "MGT 103Q: Intro to Entrepreneurial Thinking" value = "MGT103Q"/>
              <Picker.item label = "MGT 103R: Intro to Entrepreneurial Thinking" value = "MGT103R"/>*/